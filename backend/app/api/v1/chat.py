from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db, get_db_readonly
from app.models import ChatMessage, ChatSession, User
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_service import RateLimited, process_chat_message

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    db_readonly: Session = Depends(get_db_readonly),
    user: User = Depends(get_current_user),
):
    try:
        session_id, sql, answer = process_chat_message(
            db, db_readonly, user.id, body.message, body.session_id
        )
    except RateLimited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Chat rate limit reached — try again in about an hour",
        )
    return ChatResponse(session_id=session_id, sql=sql, message=answer)


@router.get("/sessions")
def list_sessions(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user.id, ChatSession.deleted_at.is_(None))
        .order_by(ChatSession.updated_at.desc())
        .all()
    )


@router.get("/sessions/{session_id}/messages")
def session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
            ChatSession.deleted_at.is_(None),
        )
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Session not found")
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
