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
from app.models import Settlement, SplitGroup, SplitMember, User
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


def _others(group: SplitGroup, actor_id: str) -> list:
    """The members with accounts on this tab, but whoever did it."""
    return [
        m
        for m in group.members
        if not m.deleted_at and m.user_id and m.user_id != actor_id
    ]


def split_added(
    db: Session,
    group: SplitGroup,
    actor_id: str,
    merchant: str,
    total: float,
    shares: Dict[str, float],
    changed: bool = False,
) -> None:
    """Tell each account on the tab (but whoever added it) about a new or
    redone split."""
    actor = _name(db, group, actor_id)
    what = merchant or "a purchase"
    tab = _tab(group, actor)
    title = (
        f"{actor} changed {what} on {tab}"
        if changed
        else f"{actor} added {what} to {tab}"
    )
    for member in _others(group, actor_id):
        share = shares.get(member.id)
        tell(
            db,
            member.user_id,
            title,
            f"${total:,.2f} in all"
            + (f". Your share: ${share:,.2f}." if share else "."),
            f"/app/groups/{group.id}",
        )


def splits_changed(db: Session, receipt, actor_id: str, changed: list) -> None:
    """Shares moved after the receipt was corrected (split_service.reshare)."""
    for split, shares in changed:
        split_added(
            db,
            db.get(SplitGroup, split.group_id),
            actor_id,
            receipt.merchant,
            receipt.total,
            shares,
            changed=True,
        )


def split_removed(db: Session, group: SplitGroup, actor_id: str, merchant: str) -> None:
    actor = _name(db, group, actor_id)
    for member in _others(group, actor_id):
        tell(
            db,
            member.user_id,
            f"{actor} removed {merchant or 'a purchase'} from {_tab(group, actor)}",
            "What everyone owes is updated.",
            f"/app/groups/{group.id}",
        )


def paid(db: Session, group: SplitGroup, payment: Settlement, actor_id: str) -> None:
    """A payment was marked: tell the payer and the payee, unless they marked it."""
    members = {m.id: m for m in group.members}
    payer, payee = members[payment.from_member_id], members[payment.to_member_id]
    actor = _name(db, group, actor_id)
    amount = f"${payment.amount:,.2f}"
    body = f"On {_tab(group, actor)}. If that's not right, tap Undo there."
    url = f"/app/groups/{group.id}"
    if payee.user_id and payee.user_id != actor_id:
        tell(db, payee.user_id, f"{payer.name} paid you {amount}", body, url)
    if payer.user_id and payer.user_id != actor_id:
        to = "them" if payee.user_id == actor_id else payee.name
        tell(
            db, payer.user_id, f"{actor} marked that you paid {to} {amount}", body, url
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
