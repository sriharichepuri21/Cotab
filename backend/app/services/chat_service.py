"""Chat orchestration: rate-limit -> tool loop -> final text response.

Phase 1 architecture:
  1. Gemini picks a tool (typed args, no SQL exposure)
  2. We execute it server-side (user_id always injected, never from the LLM)
  3. Tool result goes back to Gemini as a function_response
  4. Gemini either calls another tool OR emits final text

Safety rails:
  - MAX_ITERATIONS=5 hard cap on the tool loop. After 5 tools, we force a
    final text response — no runaway quota burn.
  - Tool errors return structured {status, hint} to Gemini — never raw
    exceptions, never schema leaks, never stack traces.
  - No custom-SQL escape hatch. Unmatched intents get a graceful "I can't
    answer that yet" response and we log for future tool-building.
"""

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import ChatActionProposal, ChatMessage, ChatSession
from app.services import chat_tools, quick_answers
from app.services.gemini_service import reformulate_question, start_chat_with_tools
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# Hard cap — expires after this many tool calls, the model is forced to write
# a final text reply. Prevents runaway loops from burning Gemini quota.
MAX_ITERATIONS = 5
MUTATION_TOOLS = {"add_budget", "create_split"}


def infer_tool_hint(message: str) -> Optional[str]:
    """High-confidence lexical hint; Gemini still owns argument extraction."""
    text = message.lower()
    if any(word in text for word in ("create", "set", "add")) and "budget" in text:
        return "add_budget"
    if any(word in text for word in ("split", "divide", "share")) and any(
        word in text for word in ("receipt", "bill", "this", "it")
    ):
        return "create_split"
    if "budget" in text and any(
        word in text for word in ("status", "left", "remaining", "over", "used")
    ):
        return "get_budget_status"
    if any(word in text for word in ("bought", "buy", "item", "stuff", "product")):
        return "find_receipts"
    if "which receipt" in text and any(
        word in text for word in ("has", "contains", "included")
    ):
        return "find_receipts"
    if any(word in text for word in ("receipt", "bill", "transaction")) and any(
        word in text for word in ("show", "list", "latest", "recent")
    ):
        return "list_receipts"
    if any(word in text for word in ("spend", "spent", "cost", "total", "much")):
        return "get_spend_summary"
    return None


_REFERRING = re.compile(
    r"\b(this|that|these|those|it|its|they|them|their|here|there|same|again|"
    r"else|also|instead|one|ones|what about|how about)\b",
    re.IGNORECASE,
)


def needs_rewrite(
    message: str, context: Optional[Dict[str, Any]], history: list
) -> bool:
    """Whether the question leans on something outside itself."""
    if context:
        return True
    return bool(history) and bool(_REFERRING.search(message))


@dataclass
class ChatResult:
    session_id: str
    message: str
    reformulated: str
    explanation: List[Dict[str, Any]]
    proposal: Optional[ChatActionProposal] = None


def _check_rate_limit(user_id: str) -> None:
    try:
        check_rate_limit("chat", user_id, settings.rate_limit_chat_per_hour)
    except RateLimitExceeded:
        raise RateLimited()
    except RateLimitUnavailable as exc:
        raise RateLimiterUnavailable() from exc


class RateLimited(Exception):
    pass


class RateLimiterUnavailable(Exception):
    pass


def _tool_name_enum_variants() -> List[str]:
    """Loose enum for the model. Gemini SDK validates against the schema; we
    keep this list for the system prompt and for tests."""
    return list(chat_tools.TOOL_REGISTRY.keys())


def _call_tool(
    name: str,
    args: Dict[str, Any],
    db: Session,
    user_id: str,
    session_id: Optional[str] = None,
    db_readonly: Optional[Session] = None,
    user_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatch a tool call. Always returns a structured envelope; never raises.

    Every tool is called with (db, user_id, **args) so user_id cannot be
    forged by the LLM even if it tries to pass one as a parameter.
    """
    fn = chat_tools.TOOL_REGISTRY.get(name)
    if fn is None:
        return {
            "status": "error",
            "hint": f"Unknown tool '{name}'. Available: {', '.join(chat_tools.TOOL_REGISTRY.keys())}.",
        }
    if name in {
        "execute_sql",
        "line_items_search",
    } and not settings.execute_sql_is_enabled_for(user_id, user_email):
        return {
            "status": "error",
            "hint": "Schema-aware queries are not enabled for this account.",
        }
    # Strip any LLM-supplied user_id so it cannot exfiltrate others' data
    args = {
        k: v
        for k, v in (args or {}).items()
        if k not in ("user_id", "user_email", "db", "db_readonly")
    }
    if name in MUTATION_TOOLS:
        if not session_id:
            return {
                "status": "error",
                "hint": "Mutation proposal needs a chat session.",
            }
        summary = _proposal_summary(name, args)
        encoded = json.dumps(args, sort_keys=True)
        existing = (
            db.query(ChatActionProposal)
            .filter(
                ChatActionProposal.user_id == user_id,
                ChatActionProposal.session_id == session_id,
                ChatActionProposal.tool_name == name,
                ChatActionProposal.payload == encoded,
                ChatActionProposal.status == "pending",
                ChatActionProposal.expires_at > datetime.now(timezone.utc),
            )
            .first()
        )
        if existing:
            return {
                "status": "pending_confirmation",
                "proposal_id": existing.id,
                "summary": existing.summary,
                "payload": args,
            }
        proposal = ChatActionProposal(
            user_id=user_id,
            session_id=session_id,
            tool_name=name,
            payload=encoded,
            summary=summary,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db.add(proposal)
        db.commit()
        db.refresh(proposal)
        return {
            "status": "pending_confirmation",
            "proposal_id": proposal.id,
            "summary": summary,
            "payload": args,
        }
    try:
        tool_db = db_readonly if name == "execute_sql" else db
        if tool_db is None:
            return {
                "status": "error",
                "hint": "The read-only query connection is not configured.",
            }
        if name in {"execute_sql", "line_items_search"}:
            return fn(tool_db, user_id, user_email=user_email, **args)
        return fn(tool_db, user_id, **args)
    except TypeError as e:
        # Bad/missing arg from the LLM — tell it so it can retry or rephrase
        logger.warning("Tool %s called with bad arguments %s: %s", name, args, e)
        return {"status": "error", "hint": f"Tool '{name}' got bad arguments: {e}"}
    except Exception:
        # Log the real traceback server-side; the LLM only ever sees the hint,
        # since raw exception text can leak schema details.
        logger.exception("Tool %s failed (args=%s)", name, args)
        return {
            "status": "error",
            "hint": f"Tool '{name}' failed internally. Try a different question.",
        }


def _proposal_summary(name: str, args: Dict[str, Any]) -> str:
    if name == "add_budget":
        return (
            f"Create a {args.get('currency', 'USD')} "
            f"{float(args.get('amount', 0)):,.2f} monthly "
            f"{args.get('category', '')} budget?"
        )
    people = ", ".join(args.get("member_names", []))
    return f"Split receipt {args.get('receipt_id', '')} evenly with {people}?"


def _history(db: Session, session_id: str) -> list:
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
        .all()
    )[::-1]
    return [
        {
            "role": "model" if row.role == "assistant" else "user",
            "parts": [row.content],
        }
        for row in rows
    ]


def _result_summary(result: Dict[str, Any]) -> str:
    if result.get("status") == "ok":
        data = result.get("data", {})
        keys = ", ".join(list(data)[:6]) if isinstance(data, dict) else "result"
        return f"Returned {keys}"
    return str(result.get("summary") or result.get("hint") or result.get("status"))[
        :240
    ]


def _force_final_text(chat_session, fallback: str) -> str:
    """After hitting MAX_ITERATIONS, send a 'compose now' nudge without tools."""
    try:
        resp = chat_session.send_message(
            "Please compose your final answer to the user using the tool results above. "
            "Do not call any more tools."
        )
        text = (resp.text or "").strip()
        return text if text else fallback
    except Exception:
        return fallback


def _persist_answer(db: Session, session_id: str, answer: str, trace: list) -> None:
    db.add(
        ChatMessage(
            session_id=session_id,
            role="assistant",
            content=answer,
            tool_trace=json.dumps(trace),
        )
    )
    db.commit()


def process_chat_message(
    db: Session,
    db_readonly: Session,  # kept for signature compatibility; not used yet
    user_id: str,
    message: str,
    session_id: str | None,
    context: Optional[Dict[str, Any]] = None,
    user_email: Optional[str] = None,
) -> ChatResult:
    """Run one user message through the tool loop and persist the turn.

    Returns the answer, bounded history context, trace, and optional proposal.
    """
    # Session bookkeeping — find-or-create
    if session_id:
        chat_row = (
            db.query(ChatSession)
            .filter(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
                ChatSession.deleted_at.is_(None),
            )
            .first()
        )
    else:
        chat_row = None
    if not chat_row:
        chat_row = ChatSession(user_id=user_id, title=message[:60])
        db.add(chat_row)
        db.commit()
        db.refresh(chat_row)

    previous_history = _history(db, chat_row.id)
    db.add(
        ChatMessage(
            session_id=chat_row.id,
            role="user",
            content=message,
            context=json.dumps(context or {}, sort_keys=True),
        )
    )
    db.commit()

    # Common spending questions are answered from the database directly:
    # instant, free, and they don't count against the AI rate limit.
    quick = quick_answers.try_answer(db, user_id, message, context)
    if quick:
        _persist_answer(db, chat_row.id, quick.text, quick.trace)
        return ChatResult(chat_row.id, quick.text, message, quick.trace)

    _check_rate_limit(user_id)

    # The rewrite pass exists to resolve "this"/"it" against page context and
    # earlier turns. Without either, it is a whole extra AI round trip (about a
    # second, plus its cost) for nothing, so skip it.
    reformulated = (
        reformulate_question(message, context)
        if needs_rewrite(message, context, previous_history)
        else message
    )
    contextual_message = reformulated
    hint = infer_tool_hint(message)
    if hint:
        contextual_message += f"\nHIGH-CONFIDENCE ROUTING HINT: prefer {hint}."
    if context:
        contextual_message += (
            f"\nPAGE CONTEXT (trusted): {json.dumps(context, sort_keys=True)}"
        )

    try:
        chat_session = start_chat_with_tools(
            history=previous_history,
            user_id=user_id,
            user_email=user_email,
        )
    except Exception:
        logger.exception("Failed to start Gemini chat session")
        answer = "Chat isn't configured on the server right now — please ask the admin to check GEMINI_API_KEY."
        _persist_answer(db, chat_row.id, answer, [])
        return ChatResult(chat_row.id, answer, reformulated, [])

    tools_called: List[str] = []
    trace: List[Dict[str, Any]] = []
    proposal: Optional[ChatActionProposal] = None
    try:
        response = chat_session.send_message(contextual_message)

        for _iteration in range(MAX_ITERATIONS):
            # Pull any function calls from the response
            calls: List[Any] = []
            for part in response.candidates[0].content.parts:
                fc = getattr(part, "function_call", None)
                if fc and fc.name:
                    calls.append(fc)

            if not calls:
                # Model gave final text — we're done
                break

            # Execute each tool and bundle responses
            response_parts = []
            for fc in calls:
                args = dict(fc.args) if fc.args else {}
                result = _call_tool(
                    fc.name,
                    args,
                    db,
                    user_id,
                    chat_row.id,
                    db_readonly=db_readonly,
                    user_email=user_email,
                )
                tools_called.append(fc.name)
                trace.append(
                    {
                        "tool": fc.name,
                        "arguments": args,
                        "result_summary": _result_summary(result),
                        "data": result.get("data", {}),
                    }
                )
                if result.get("proposal_id"):
                    proposal = (
                        db.query(ChatActionProposal)
                        .filter(ChatActionProposal.id == result["proposal_id"])
                        .first()
                    )
                response_parts.append(
                    genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=fc.name,
                            response={"result": result},
                        )
                    )
                )

            response = chat_session.send_message(
                genai.protos.Content(parts=response_parts, role="function")
            )
        else:
            # Loop exhausted without final text — force it
            fallback = (
                "I wasn't able to put together a clear answer from that. "
                "Could you rephrase, or ask something simpler like "
                "'how much did I spend on groceries this month?'"
            )
            answer = _force_final_text(chat_session, fallback)
            _persist_answer(db, chat_row.id, answer, trace)
            return ChatResult(chat_row.id, answer, reformulated, trace, proposal)

        # Normal exit: final text from the last response
        answer = (response.text or "").strip() or (
            "I couldn't quite answer that. Try asking about your spending, "
            "budgets, or receipts — for example 'show my last 5 receipts.'"
        )
    except google_exceptions.ResourceExhausted:
        # Upstream Gemini quota/rate limit — distinct from our own per-user
        # limiter, and distinct from a genuine bug. Say so plainly.
        logger.warning(
            "Gemini quota exhausted (user=%s, tools=%s)", user_id, tools_called
        )
        answer = (
            "I've hit my AI usage limit for now — please try again in a few minutes. "
            "(If this keeps happening, the server's Gemini API quota needs raising.)"
        )
        _persist_answer(db, chat_row.id, answer, trace)
        return ChatResult(chat_row.id, answer, reformulated, trace, proposal)
    except Exception:
        # Network errors, malformed Gemini responses, anything unforeseen.
        # Log the traceback — without it, failures here are invisible in prod.
        logger.exception(
            "Chat tool loop failed (user=%s, tools_called=%s)", user_id, tools_called
        )
        answer = "I'm having trouble thinking right now — please try again in a moment."
        _persist_answer(db, chat_row.id, answer, trace)
        return ChatResult(chat_row.id, answer, reformulated, trace, proposal)

    _persist_answer(db, chat_row.id, answer, trace)
    return ChatResult(chat_row.id, answer, reformulated, trace, proposal)
