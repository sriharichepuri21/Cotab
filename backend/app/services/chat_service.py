"""Chat: one question in, a streamed answer out.

A turn has two halves:

1. `prepare_turn` (fast, can refuse): finds or starts the conversation, saves
   the question, answers common spending questions straight from the database
   (instant and free), and checks the rate limit and AI budget. Refusals raise
   before anything is streamed, so the API can answer with a proper status.
2. `run_turn` (a generator of events): asks Gemini with the person's account
   summary in the prompt, so most answers need no lookups at all. When the
   model does call a tool, it runs here (user id always injected server-side,
   never taken from the model), the result goes back, and the loop continues
   for at most MAX_STEPS steps.

Events are small dicts: {"type": "status" | "delta" | "proposal" | "done"}.
"delta" carries answer text as it is written. Tool calls, SQL and ids are
never sent to the browser; the trace is stored with the message for debugging.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional

from google.genai import types
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import ChatActionProposal, ChatMessage, ChatSession, User
from app.services import (
    ai_client,
    ai_usage,
    chat_ai,
    chat_context,
    chat_tools,
    quick_answers,
    tabby_actions,
)
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# Model round trips per question. Most answers take one; a lookup takes two.
MAX_STEPS = 5
HISTORY_MESSAGES = 12
MUTATION_TOOLS = {"add_budget", "create_split", "split_purchase", "settle_up"}
# Tool results larger than this are trimmed before going back to the model.
MAX_ROWS = 60

STATUS_TEXT = {
    "get_spend_summary": "Adding up your spending…",
    "execute_sql": "Crunching the numbers…",
    "line_items_search": "Looking through your items…",
    "list_receipts": "Looking through your receipts…",
    "find_receipts": "Looking through your receipts…",
    "get_receipt": "Opening that receipt…",
    "get_budget_status": "Checking your budget…",
    "create_split": "Setting up the split…",
    "add_budget": "Setting up the budget…",
    "find_purchases": "Finding that purchase…",
    "find_people": "Checking who that is…",
    "split_purchase": "Working out the split…",
    "settle_up": "Checking what's owed…",
    "ask_user": "Asking you…",
}

TROUBLE = "Sorry, I couldn't answer that just now. Please try again in a moment."
BUSY = "Cotab's assistant is very busy right now. Please try again in a minute."


class RateLimited(Exception):
    pass


class RateLimiterUnavailable(Exception):
    pass


@dataclass
class ChatResult:
    session_id: str
    message: str
    reformulated: str
    explanation: List[Dict[str, Any]]
    proposal: Optional[ChatActionProposal] = None


@dataclass
class Turn:
    """Everything `run_turn` needs, gathered by `prepare_turn`."""

    db: Session
    db_readonly: Optional[Session]
    user_id: str
    user_email: Optional[str]
    message: str
    context: Dict[str, Any]
    # The id only: the streaming half may run after the request's session was
    # closed, when ORM objects from it can no longer be read.
    session_id: str
    history: List[types.Content]
    # Set when the question was answered without the AI.
    ready_answer: Optional[str] = None
    trace: List[Dict[str, Any]] = field(default_factory=list)


def _check_rate_limit(user_id: str) -> None:
    try:
        check_rate_limit("chat", user_id, settings.rate_limit_chat_per_hour)
    except RateLimitExceeded:
        raise RateLimited()
    except RateLimitUnavailable as exc:
        raise RateLimiterUnavailable() from exc


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def _call_tool(
    name: str,
    args: Dict[str, Any],
    db: Session,
    user_id: str,
    session_id: Optional[str] = None,
    db_readonly: Optional[Session] = None,
    user_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Run one tool. Always returns a {status, ...} envelope; never raises.

    Every tool gets (db, user_id, **args), and any user id the model tries to
    pass is dropped, so it can only ever see this person's data.
    """
    fn = chat_tools.TOOL_REGISTRY.get(name)
    if fn is None:
        return {
            "status": "error",
            "hint": f"Unknown tool '{name}'. Available: {', '.join(chat_tools.TOOL_REGISTRY)}.",
        }
    if name in {
        "execute_sql",
        "line_items_search",
    } and not settings.execute_sql_is_enabled_for(user_id, user_email):
        return {
            "status": "error",
            "hint": "Schema-aware queries are not enabled for this account.",
        }
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
        if name in tabby_actions.ACTIONS:
            # Check it can be done and work out the exact amounts first; a
            # problem or a doubt goes back to Tabby to ask about, and only a
            # complete plan becomes a Confirm card.
            prepared = tabby_actions.ACTIONS[name][0](db, user_id, args)
            if prepared.get("status") != "ok":
                return prepared
            summary = prepared["data"]["summary"]
            args = prepared["data"]["plan"]
        else:
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
        logger.warning("Tool %s called with bad arguments %s: %s", name, args, e)
        return {"status": "error", "hint": f"Tool '{name}' got bad arguments: {e}"}
    except Exception:
        logger.exception("Tool %s failed (args=%s)", name, args)
        return {
            "status": "error",
            "hint": f"Tool '{name}' failed internally. Try a different approach.",
        }


def _proposal_summary(name: str, args: Dict[str, Any]) -> str:
    if name == "add_budget":
        level = (args.get("level") or "category").lower()
        if level in ("store", "shop"):
            level = "merchant"
        period = (args.get("period") or "monthly").lower()
        target = (args.get("target") or args.get("category") or "").strip()
        currency = args.get("currency") or "USD"
        amount = f"{float(args.get('amount', 0)):,.2f}"
        money = f"${amount}" if currency == "USD" else f"{amount} {currency}"
        what = {
            "category": f"{target} spending",
            "merchant": f"purchases at {target}",
            "item": f"items matching \u201c{target}\u201d",
            "total": "everything you spend",
        }.get(level, target)
        return f"Set a {money} {period} budget for {what}?"
    people = ", ".join(args.get("member_names", []))
    return f"Split this receipt evenly with {people}?"


def _for_model(result: Dict[str, Any]) -> Dict[str, Any]:
    """What goes back to the model: the result without the SQL text (it wrote
    that itself, and it must never echo it), with long row lists trimmed."""
    out = dict(result)
    data = out.get("data")
    if isinstance(data, dict):
        data = {k: v for k, v in data.items() if k != "sql"}
        for key, value in list(data.items()):
            if isinstance(value, list) and len(value) > MAX_ROWS:
                data[key] = value[:MAX_ROWS]
                data[f"{key}_note"] = f"first {MAX_ROWS} of {len(value)} shown"
        out["data"] = data
    return out


# ---------------------------------------------------------------------------
# A turn
# ---------------------------------------------------------------------------


def _history(db: Session, session_id: str) -> List[types.Content]:
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(HISTORY_MESSAGES)
        .all()
    )[::-1]
    out: List[types.Content] = []
    for row in rows:
        role = "model" if row.role == "assistant" else "user"
        # Gemini wants turns to alternate; merge any back-to-back same-role rows.
        if out and out[-1].role == role:
            out[-1].parts.append(types.Part.from_text(text=row.content or ""))
        else:
            out.append(
                types.Content(
                    role=role, parts=[types.Part.from_text(text=row.content or "")]
                )
            )
    # A conversation sent to the model must start with the person.
    while out and out[0].role != "user":
        out.pop(0)
    return out


def _persist_answer(db: Session, session_id: str, answer: str, trace: list) -> None:
    db.add(
        ChatMessage(
            session_id=session_id,
            role="assistant",
            content=answer,
            tool_trace=json.dumps(trace, default=str),
        )
    )
    session = db.get(ChatSession, session_id)
    if session is not None:
        session.updated_at = datetime.now(timezone.utc)
    db.commit()


def prepare_turn(
    db: Session,
    db_readonly: Optional[Session],
    user_id: str,
    message: str,
    session_id: Optional[str],
    context: Optional[Dict[str, Any]] = None,
    user_email: Optional[str] = None,
) -> Turn:
    """Save the question and decide how it will be answered. Raises
    RateLimited / RateLimiterUnavailable before anything is streamed."""
    chat_row = None
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
    if not chat_row:
        chat_row = ChatSession(user_id=user_id, title=message[:60])
        db.add(chat_row)
        db.commit()
        db.refresh(chat_row)

    chat_id = chat_row.id
    history = _history(db, chat_id)
    db.add(
        ChatMessage(
            session_id=chat_id,
            role="user",
            content=message,
            context=json.dumps(context or {}, sort_keys=True),
        )
    )
    db.commit()

    turn = Turn(
        db=db,
        db_readonly=db_readonly,
        user_id=user_id,
        user_email=user_email,
        message=message,
        context=context or {},
        session_id=chat_id,
        history=history,
    )

    # Common spending questions straight from the database: instant, free,
    # and they don't count against the AI rate limit.
    quick = quick_answers.try_answer(db, user_id, message, context)
    if quick:
        turn.ready_answer, turn.trace = quick.text, quick.trace
        return turn

    _check_rate_limit(user_id)
    try:
        ai_usage.check(user_id, db)
    except ai_usage.AILimitReached as limit:
        turn.ready_answer = (
            f"{limit.message} Quick questions like "
            "“How much did I spend this month?” still work."
        )
    return turn


def _screen_context(turn: Turn) -> str:
    """What the person is looking at, so "this receipt" needs no lookup."""
    receipt_id = turn.context.get("receipt_id")
    page = turn.context.get("page") or ""
    if receipt_id:
        found = chat_tools.get_receipt(turn.db, turn.user_id, str(receipt_id))
        if found.get("status") == "ok":
            return "RECEIPT ON SCREEN:\n" + json.dumps(found["data"], default=str)
    if page:
        return f"The person is on the page {page}."
    return ""


def _system_prompt(turn: Turn) -> str:
    user = turn.db.get(User, turn.user_id)
    summary = chat_context.build(turn.db, user) if user else ""
    parts = [
        chat_ai._chat_system_prompt(turn.user_id, turn.user_email),
        "ACCOUNT SUMMARY (current):\n" + summary,
    ]
    screen = _screen_context(turn)
    if screen:
        parts.append(screen)
    return "\n\n".join(parts)


def _proposal_dict(row: ChatActionProposal) -> Dict[str, Any]:
    return {
        "id": row.id,
        "tool_name": row.tool_name,
        "summary": row.summary,
        "payload": json.loads(row.payload),
        "status": row.status,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


def _stream_step(user_id: str, model: str, contents, config):
    """One model round trip, within the AI budget and logged once at the end.

    The user id is passed explicitly rather than through `ai_usage.acting_for`:
    a streamed response is iterated in a fresh context for every chunk, where
    a context variable set at the start isn't visible.
    """
    ai_usage.check(user_id)
    last = None
    for chunk in ai_client.stream(model, contents, config):
        last = chunk
        yield chunk
    if last is not None:
        ai_usage.record("chat", model, last, user_id=user_id)


def run_turn(turn: Turn) -> Iterator[Dict[str, Any]]:
    """Answer the question, yielding events as the answer is written."""
    if turn.ready_answer is not None:
        yield {"type": "delta", "text": turn.ready_answer}
        _persist_answer(turn.db, turn.session_id, turn.ready_answer, turn.trace)
        yield {"type": "done", "session_id": turn.session_id}
        return

    yield from _ai_turn(turn)


def _ai_turn(turn: Turn) -> Iterator[Dict[str, Any]]:
    model = settings.gemini_model
    trace: List[Dict[str, Any]] = []
    answer: List[str] = []
    proposal: Optional[ChatActionProposal] = None
    choices: Optional[Dict[str, Any]] = None
    try:
        system = _system_prompt(turn)
        tools = chat_ai._chat_tool_declarations(turn.user_id, turn.user_email)
        contents: List[types.Content] = list(turn.history) + [
            types.Content(role="user", parts=[types.Part.from_text(text=turn.message)])
        ]
        for step in range(MAX_STEPS):
            final = step == MAX_STEPS - 1
            config = chat_ai.chat_config(system, tools, model, final=final)
            parts: List[types.Part] = []
            calls: List[types.FunctionCall] = []
            for chunk in _stream_step(turn.user_id, model, contents, config):
                candidate = chunk.candidates[0] if chunk.candidates else None
                if (
                    not candidate
                    or not candidate.content
                    or not candidate.content.parts
                ):
                    continue
                for part in candidate.content.parts:
                    # Kept exactly as sent, thought signatures included: Gemini
                    # needs them back on the next step.
                    parts.append(part)
                    if part.function_call:
                        calls.append(part.function_call)
                    elif part.text and not part.thought:
                        answer.append(part.text)
                        yield {"type": "delta", "text": part.text}
            if parts:
                contents.append(types.Content(role="model", parts=parts))
            if not calls:
                break

            responses = []
            for call in calls:
                yield {
                    "type": "status",
                    "text": STATUS_TEXT.get(call.name or "", "Working on it…"),
                }
                args = dict(call.args or {})
                if call.name == "ask_user":
                    # Shown as tappable answers under Tabby's reply.
                    options = [
                        str(o).strip()[:60]
                        for o in (args.get("options") or [])
                        if str(o).strip()
                    ][:5]
                    choices = {
                        "question": str(args.get("question") or ""),
                        "options": options,
                    }
                    result = {
                        "status": "ok",
                        "data": {
                            "shown": True,
                            "note": "The options appear as buttons under your reply. "
                            "Write the question in your reply, then stop and wait.",
                        },
                    }
                else:
                    result = _call_tool(
                        call.name or "",
                        args,
                        turn.db,
                        turn.user_id,
                        turn.session_id,
                        db_readonly=turn.db_readonly,
                        user_email=turn.user_email,
                    )
                    asked = (
                        result.get("data")
                        if isinstance(result.get("data"), dict)
                        else {}
                    )
                    if result.get("status") == "needs_clarification" and asked.get(
                        "options"
                    ):
                        choices = {
                            "question": result.get("hint", ""),
                            "options": asked["options"],
                        }
                trace.append(
                    {
                        "tool": call.name,
                        "arguments": args,
                        "status": result.get("status"),
                    }
                )
                if result.get("proposal_id"):
                    proposal = turn.db.get(ChatActionProposal, result["proposal_id"])
                responses.append(
                    types.Part.from_function_response(
                        name=call.name or "", response={"result": _for_model(result)}
                    )
                )
            contents.append(types.Content(role="user", parts=responses))
            if answer:
                # Separate any lead-in ("Let me check…") from what follows.
                answer.append("\n\n")
                yield {"type": "delta", "text": "\n\n"}
    except ai_usage.AILimitReached as limit:
        answer.append(limit.message)
        yield {"type": "delta", "text": limit.message}
    except Exception as exc:
        if ai_client.is_quota_error(exc):
            logger.warning("Gemini quota exhausted (user=%s)", turn.user_id)
            text = BUSY
        else:
            logger.exception(
                "Chat turn failed (user=%s, trace=%s)", turn.user_id, trace
            )
            text = TROUBLE
        if "".join(answer).strip():
            text = "\n\n" + text
        answer.append(text)
        yield {"type": "delta", "text": text}

    final_text = "".join(answer).strip()
    if not final_text:
        final_text = (
            "I couldn't find an answer to that. Try asking about your spending, a "
            "store, a budget or a receipt."
        )
        yield {"type": "delta", "text": final_text}
    if proposal is not None:
        yield {"type": "proposal", "proposal": _proposal_dict(proposal)}
    elif choices and choices["options"]:
        yield {"type": "choices", "options": choices["options"]}
    _persist_answer(turn.db, turn.session_id, final_text, trace)
    yield {"type": "done", "session_id": turn.session_id}


def process_chat_message(
    db: Session,
    db_readonly: Optional[Session],
    user_id: str,
    message: str,
    session_id: Optional[str],
    context: Optional[Dict[str, Any]] = None,
    user_email: Optional[str] = None,
) -> ChatResult:
    """The whole turn at once, for callers that don't stream."""
    turn = prepare_turn(
        db, db_readonly, user_id, message, session_id, context, user_email
    )
    text: List[str] = []
    proposal = None
    for event in run_turn(turn):
        if event["type"] == "delta":
            text.append(event["text"])
        elif event["type"] == "proposal":
            proposal = db.get(ChatActionProposal, event["proposal"]["id"])
    return ChatResult(
        turn.session_id, "".join(text).strip(), message, turn.trace, proposal
    )
