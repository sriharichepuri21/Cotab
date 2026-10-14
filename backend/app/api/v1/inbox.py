"""Forwarding receipts by email.

`/inbox` is what Settings shows: the person's address, who may forward to
it, and what happened to recent emails. `/inbound/resend` is the webhook
Resend calls when mail arrives; it checks the signature, decides quickly
whether the email is for someone and from an allowed sender, answers, and
leaves the reading to a background task.
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import InboundEmail, InboxSender, User
from app.services import inbound_processor, inbox_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["inbox"])

_GMAIL_CONFIRMATION = re.compile(r"\(#(\d{5,})\)\s*Gmail Forwarding Confirmation", re.I)

# A day's worth for even a heavy shopper; stops a mail loop filling the tab.
EMAILS_PER_DAY = 100


def _process_later(inbound_id: str) -> None:
    """Read the email after the webhook has answered (swapped out in tests)."""
    inbound_processor.process(inbound_id)


class SenderOut(BaseModel):
    id: str
    email: str

    class Config:
        from_attributes = True


class RecentEmail(BaseModel):
    id: str
    subject: str
    from_address: str
    status: str
    reason: str
    receipt_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InboxOut(BaseModel):
    enabled: bool
    address: Optional[str] = None
    account_email: str
    senders: List[SenderOut] = []
    recent: List[RecentEmail] = []


class SenderIn(BaseModel):
    email: str


def _refuse(http_status: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message}
    )


def _inbox(db: Session, user: User) -> InboxOut:
    if not get_settings().email_forwarding_enabled():
        return InboxOut(enabled=False, account_email=user.email)
    alias = inbox_service.ensure_alias(db, user)
    recent = (
        db.query(InboundEmail)
        .filter(InboundEmail.user_id == user.id, InboundEmail.deleted_at.is_(None))
        .order_by(InboundEmail.created_at.desc())
        .limit(10)
        .all()
    )
    return InboxOut(
        enabled=True,
        address=inbox_service.address_for(alias),
        account_email=user.email,
        senders=[
            SenderOut.model_validate(s) for s in inbox_service.senders(db, user.id)
        ],
        recent=[RecentEmail.model_validate(r) for r in recent],
    )


@router.get("/inbox", response_model=InboxOut)
def get_inbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _inbox(db, user)


@router.post(
    "/inbox/senders", response_model=InboxOut, status_code=status.HTTP_201_CREATED
)
def add_sender(
    body: SenderIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    email = body.email.strip().lower()
    if not inbox_service.valid_email(email):
        raise _refuse(422, "bad_email", "That doesn't look like an email address.")
    if email in inbox_service.allowed_senders(db, user):
        return _inbox(db, user)
    if len(inbox_service.senders(db, user.id)) >= inbox_service.MAX_SENDERS:
        raise _refuse(
            409,
            "too_many_senders",
            f"You can forward from up to {inbox_service.MAX_SENDERS} other addresses.",
        )
    # A removed address is soft-deleted; bring it back rather than duplicate it.
    old = (
        db.query(InboxSender)
        .filter(InboxSender.user_id == user.id, InboxSender.email == email)
        .first()
    )
    if old:
        old.deleted_at = None
    else:
        db.add(InboxSender(user_id=user.id, email=email))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return _inbox(db, user)


@router.delete("/inbox/senders/{sender_id}", response_model=InboxOut)
def remove_sender(
    sender_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = next(
        (s for s in inbox_service.senders(db, user.id) if s.id == sender_id), None
    )
    if not row:
        raise HTTPException(status_code=404, detail="Address not found")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return _inbox(db, user)


@router.post("/inbox/new-address", response_model=InboxOut)
def new_address(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Retire the current address (say it's getting spam) and make a new one."""
    if not get_settings().email_forwarding_enabled():
        raise HTTPException(status_code=404, detail="Email forwarding is off")
    inbox_service.new_alias(db, user)
    return _inbox(db, user)


@router.post("/inbound/resend", status_code=status.HTTP_200_OK)
async def resend_webhook(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Resend calls this for every email that reaches a Cotab address.

    Answers within milliseconds: a 2xx tells Resend not to retry. Anything
    we can decide without fetching the email (wrong signature, unknown
    address, sender not allowed, already seen) is decided here.
    """
    settings = get_settings()
    if not settings.email_forwarding_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    body = await request.body()
    try:
        inbox_service.verify_signature(
            settings.resend_webhook_secret or "", dict(request.headers), body
        )
    except inbox_service.BadSignature as exc:
        logger.warning("Rejected an inbound webhook: %s", exc)
        raise HTTPException(status_code=401, detail="Bad signature")

    try:
        event = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad JSON")
    if event.get("type") != "email.received":
        return {"ok": True, "ignored": "event type"}

    data = event.get("data") or {}
    provider_id = str(data.get("email_id") or "")
    if not provider_id:
        raise HTTPException(status_code=400, detail="No email id")
    if (
        db.query(InboundEmail.id)
        .filter(InboundEmail.provider_id == provider_id)
        .first()
    ):
        return {"ok": True, "duplicate": True}

    recipients = list(data.get("to") or []) + list(data.get("received_for") or [])
    user = inbox_service.user_for_recipients(db, recipients)
    from_raw = str(data.get("from") or "")
    row = InboundEmail(
        provider_id=provider_id,
        user_id=user.id if user else None,
        from_address=inbox_service.plain_address(from_raw)[:320],
        subject=str(data.get("subject") or "")[:512],
        status="queued",
    )

    gmail_code = _GMAIL_CONFIRMATION.search(row.subject or "")
    if user is None:
        row.status, row.reason = "ignored", "Unknown address"
    elif gmail_code and row.from_address.endswith("@google.com"):
        # Turning on automatic forwarding in Gmail sends a code to this
        # address first. Show it in Settings so the person can finish setup.
        row.status = "ignored"
        row.reason = (
            f"Gmail confirmation code: {gmail_code.group(1)}. Enter it in Gmail's "
            "forwarding settings to finish turning on automatic forwarding."
        )
    elif not inbox_service.is_allowed(db, user, from_raw):
        row.status = "ignored"
        row.reason = (
            f"{row.from_address or 'This sender'} isn't one of your forwarding "
            "addresses. Add it in Settings to accept mail from it."
        )
    else:
        day_ago = datetime.now(timezone.utc) - timedelta(days=1)
        today = (
            db.query(InboundEmail.id)
            .filter(InboundEmail.user_id == user.id, InboundEmail.created_at >= day_ago)
            .count()
        )
        if today >= EMAILS_PER_DAY:
            row.status, row.reason = (
                "ignored",
                "Too many emails today. Try again tomorrow.",
            )

    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the same notification arrived twice at once
        return {"ok": True, "duplicate": True}

    if row.status == "queued":
        background.add_task(_process_later, row.id)
    return Response(status_code=status.HTTP_200_OK)
