"""Telling people what happened on their tabs: a push to their phone, or an
email when no device of theirs has notifications on.

Never raises: a notification that can't go out must not undo the split or
the add that caused it.
"""

from __future__ import annotations

import logging
from typing import Dict, Iterable, Optional

import httpx
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import SplitGroup, SplitMember, User
from app.services import email_verification, push_service
from app.services.invites import participants

logger = logging.getLogger(__name__)

# Tests set this to a list to capture emails instead of sending them.
emailed: Optional[list] = None


def _email(to: str, subject: str, body: str, url: str) -> None:
    settings = get_settings()
    text = body + (
        f"\n\nOpen: {settings.app_url.rstrip('/')}{url}"
        if settings.app_url
        else "\n\nOpen Cotab to see it."
    )
    if emailed is not None:
        emailed.append({"to": to, "subject": subject, "text": text})
        return
    if not settings.email_sending_enabled():
        logger.warning("Email sending is off; notification to %s not sent", to)
        return
    response = httpx.post(
        f"{email_verification.RESEND_API}/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.email_from,
            "to": [to],
            "subject": subject,
            "text": text,
        },
        timeout=15,
    )
    if response.status_code >= 300:
        logger.error("Resend refused a notification: %s", response.text)


def tell(db: Session, user_id: str, title: str, body: str, url: str) -> None:
    """Push to their devices; email them if none got it."""
    try:
        if push_service.send(db, user_id, title, body, url):
            return
        user = db.get(User, user_id)
        if user and user.deleted_at is None:
            _email(user.email, title, body, url)
    except Exception:
        logger.exception("Couldn't notify %s", user_id)


def _name(db: Session, group: SplitGroup, user_id: str) -> str:
    """What this tab calls someone, or their account name."""
    mine = next(
        (m for m in group.members if m.user_id == user_id and m.deleted_at is None),
        None,
    )
    user = db.get(User, user_id)
    return (mine.name if mine else "") or (user.full_name if user else "") or "A friend"


def _tab(group: SplitGroup, actor: str) -> str:
    # A friend tab is called "You & Ben" from its owner's side; say it plainly.
    return f"your tab with {actor}" if group.kind == "direct" else group.name


def added(db: Session, group: SplitGroup, before: Iterable[str], actor_id: str) -> None:
    """Tell everyone on the tab now who wasn't in `before` (participants()
    taken before the change) that they were added."""
    db.refresh(group)
    actor = _name(db, group, actor_id)
    for user_id in participants(group) - set(before) - {actor_id}:
        tell(
            db,
            user_id,
            f"{actor} added you to {_tab(group, actor)}",
            "Open it to see what's on it.",
            f"/app/groups/{group.id}",
        )


def split_added(
    db: Session,
    group: SplitGroup,
    actor_id: str,
    merchant: str,
    total: float,
    shares: Dict[str, float],
) -> None:
    """Tell each account on the tab (but whoever added it) about a new split."""
    actor = _name(db, group, actor_id)
    for member in group.members:
        if member.deleted_at or not member.user_id or member.user_id == actor_id:
            continue
        share = shares.get(member.id)
        tell(
            db,
            member.user_id,
            f"{actor} added {merchant or 'a purchase'} to {_tab(group, actor)}",
            f"${total:,.2f} in all"
            + (f". Your share: ${share:,.2f}." if share else "."),
            f"/app/groups/{group.id}",
        )


def joined_cotab(db: Session, members: Iterable[SplitMember]) -> None:
    """Someone signed up and was joined to tabs they'd been put on: tell each
    tab's owner."""
    for member in members:
        group = member.group
        tell(
            db,
            group.owner_id,
            f"{member.name} joined Cotab",
            f"They're on {group.name if group.kind != 'direct' else 'your tab'} now"
            " and can settle up with you there.",
            f"/app/groups/{group.id}",
        )
