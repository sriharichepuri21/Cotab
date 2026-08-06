import time
from collections import defaultdict
from typing import Dict, Tuple

from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import ChatMessage, ChatSession
from app.services.gemini_service import generate_answer, generate_sql_from_question
from app.utils.sql_validator import SqlValidationError, enforce_user_scope, validate_sql

settings = get_settings()

# In-memory sliding-window rate limiter (swap for Redis/Upstash in prod)
_chat_windows: Dict[str, list] = defaultdict(list)


def _check_rate_limit(user_id: str) -> None:
    now = time.time()
    window = _chat_windows[user_id]
    cutoff = now - 3600
    _chat_windows[user_id] = [t for t in window if t > cutoff]
    if len(_chat_windows[user_id]) >= settings.rate_limit_chat_per_hour:
        raise RateLimited()
    _chat_windows[user_id].append(now)


class RateLimited(Exception):
    pass


def process_chat_message(
    db: Session,
    db_readonly: Session,
    user_id: str,
    message: str,
    session_id: str | None,
) -> Tuple[str, str | None, str]:
    """
    Pipeline: rate-limit -> SQL gen -> validate -> scope -> execute -> NL answer.
    Raw DB errors are NEVER passed to the LLM's second call (schema leaks) —
    a generic retry message is returned instead.
    """
    _check_rate_limit(user_id)

    # Session bookkeeping
    if session_id:
        chat = (
            db.query(ChatSession)
            .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
            .first()
        )
    else:
        chat = None
    if not chat:
        chat = ChatSession(user_id=user_id, title=message[:60])
        db.add(chat)
        db.commit()
        db.refresh(chat)

    db.add(ChatMessage(session_id=chat.id, role="user", content=message))
    db.commit()

    sql_final = None
    try:
        raw_sql = generate_sql_from_question(message)
    except Exception:
        answer = "I'm having trouble thinking right now — please try again in a moment."
        db.add(ChatMessage(session_id=chat.id, role="assistant", content=answer))
        db.commit()
        return chat.id, None, answer

    try:
        clean_sql = validate_sql(raw_sql)
        scoped_sql = enforce_user_scope(clean_sql, user_id)
    except SqlValidationError:
        answer = "I can't run that kind of query. Try asking about your spending, e.g. 'How much did I spend on groceries this month?'"
        db.add(ChatMessage(session_id=chat.id, role="assistant", content=answer))
        db.commit()
        return chat.id, None, answer

    try:
        result = db_readonly.execute(__import__("sqlalchemy").text(scoped_sql))
        rows = [dict(r._mapping) for r in result.fetchall()]
        sql_final = scoped_sql
    except Exception:
        # Deliberately NOT feeding the DB error back to the model.
        answer = (
            "That question didn't map to your data cleanly — could you rephrase it?"
        )
        db.add(ChatMessage(session_id=chat.id, role="assistant", content=answer))
        db.commit()
        return chat.id, None, answer

    try:
        answer = generate_answer(message, rows)
    except Exception:
        answer = "I found data but couldn't summarize it — please try again."

    db.add(
        ChatMessage(
            session_id=chat.id, role="assistant", content=answer, sql_used=sql_final
        )
    )
    db.commit()
    return chat.id, sql_final, answer
