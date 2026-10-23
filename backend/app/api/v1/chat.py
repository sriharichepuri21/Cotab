import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db, get_db_readonly
from app.models import ChatActionProposal, ChatMessage, ChatSession, User
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services import chat_tools, tabby_agent
from app.services.chat_service import (
    LEGACY_MUTATIONS,
    RateLimited,
    RateLimiterUnavailable,
    prepare_turn,
    run_turn,
)

router = APIRouter(prefix="/chat", tags=["chat"])


def _prepare(body: ChatRequest, db: Session, db_readonly: Session, user: User):
    try:
        return prepare_turn(
            db,
            db_readonly,
            user.id,
            body.message.strip(),
            body.session_id,
            body.context,
            user_email=user.email,
        )
    except RateLimited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've asked a lot in the last hour. Try again in a little while.",
        )
    except RateLimiterUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chat is temporarily unavailable. Please try again shortly.",
        )


@router.post("/stream")
def chat_stream(
    body: ChatRequest,
    db: Session = Depends(get_db),
    db_readonly: Session = Depends(get_db_readonly),
    user: User = Depends(get_current_user),
):
    """The answer as it is written: one JSON event per line (NDJSON).

    {"type":"status","text":...}   what the assistant is doing (a lookup)
    {"type":"delta","text":...}    the next piece of the answer
    {"type":"proposal",...}        an action to confirm (budget, split)
    {"type":"done","session_id"}   finished
    """
    turn = _prepare(body, db, db_readonly, user)

    def lines():
        try:
            for event in run_turn(turn):
                yield json.dumps(event, default=str) + "\n"
        finally:
            db.close()

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        # No proxy buffering, so each piece reaches the phone as it's written.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    db_readonly: Session = Depends(get_db_readonly),
    user: User = Depends(get_current_user),
):
    """The whole answer at once (older clients). How it was answered is not
    returned: it stays server-side."""
    turn = _prepare(body, db, db_readonly, user)
    text, proposal = [], None
    for event in run_turn(turn):
        if event["type"] == "delta":
            text.append(event["text"])
        elif event["type"] == "proposal":
            proposal = event["proposal"]
    return ChatResponse(
        session_id=turn.session_id,
        message="".join(text).strip(),
        proposal=proposal,
    )


def _proposal(db: Session, proposal_id: str, user_id: str) -> ChatActionProposal:
    row = (
        db.query(ChatActionProposal)
        .filter(
            ChatActionProposal.id == proposal_id,
            ChatActionProposal.user_id == user_id,
            ChatActionProposal.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return row


@router.post("/proposals/{proposal_id}/confirm")
def confirm_proposal(
    proposal_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = _proposal(db, proposal_id, user.id)
    if row.status == "executed":
        return {"status": "executed", "result": {"already_executed": True}}
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if row.status != "pending" or expires <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Proposal is no longer actionable")
    tabby_agent._load()
    if row.tool_name == "plan":
        steps = json.loads(row.payload)["steps"]
    elif row.tool_name in tabby_agent.ACTIONS:
        # A one-action proposal made before plans existed.
        steps = [
            {
                "action": row.tool_name,
                "step": json.loads(row.payload),
                "summary": row.summary,
            }
        ]
    elif row.tool_name in LEGACY_MUTATIONS:
        steps = None
    else:
        raise HTTPException(status_code=400, detail="Unsupported proposal")
    # Claim it first, so a second tap can't do it twice.
    row.status = "executing"
    db.commit()
    if steps is None:
        result = chat_tools.TOOL_REGISTRY[row.tool_name](
            db, user.id, **json.loads(row.payload)
        )
    else:
        result = tabby_agent.run(db, user.id, steps, run_id=row.id)
    if result.get("status") != "ok":
        row.status = "pending"
        db.commit()
        raise HTTPException(status_code=422, detail=result.get("hint", "Action failed"))
    row.status = "executed"
    row.executed_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "executed", "result": result["data"]}


@router.post("/proposals/{proposal_id}/cancel")
def cancel_proposal(
    proposal_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = _proposal(db, proposal_id, user.id)
    if row.status == "pending":
        row.status = "cancelled"
        db.commit()
    return {"status": row.status}


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
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    # Only what was said: how answers were found stays server-side.
    return [
        {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at}
        for m in rows
    ]
