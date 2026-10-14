"""Private forwarding addresses, who may send to them, and talking to Resend.

Each person gets an address like `srihari-7k2p@<id>.resend.app`. Resend
receives the mail and notifies Cotab with a signed webhook; Cotab then fetches
the message and its attachments from Resend's API.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from email.utils import parseaddr
from typing import Any, Dict, Iterable, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import InboxSender, User

RESEND_API = "https://api.resend.com"
# Webhooks older than this are refused, so a captured one can't be replayed.
SIGNATURE_TOLERANCE_SECONDS = 5 * 60
MAX_SENDERS = 10
# Letters and digits that can't be misread for each other in an address.
_ALIAS_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"


# --- addresses ---------------------------------------------------------------------


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())[:12]


def ensure_alias(db: Session, user: User) -> str:
    """This person's alias, made on first use: their name plus four random
    characters, so it's recognisable but can't be guessed."""
    if user.inbox_alias:
        return user.inbox_alias
    base = _slug(user.full_name.split(" ")[0] if user.full_name else "") or _slug(
        user.email.split("@")[0]
    )
    base = base or "me"
    for _ in range(20):
        alias = f"{base}-{''.join(secrets.choice(_ALIAS_CHARS) for _ in range(4))}"
        if not db.query(User.id).filter(User.inbox_alias == alias).first():
            user.inbox_alias = alias
            db.commit()
            return alias
    raise RuntimeError("Could not find a free forwarding address")


def new_alias(db: Session, user: User) -> str:
    """Retire the current address (say it's getting spam) and make a new one."""
    user.inbox_alias = None
    db.flush()
    return ensure_alias(db, user)


def address_for(alias: str) -> str:
    return f"{alias}@{get_settings().inbound_email_domain}"


def plain_address(raw: str) -> str:
    """'Amazon <auto-confirm@amazon.com>' -> 'auto-confirm@amazon.com'."""
    return parseaddr(raw or "")[1].strip().lower()


def user_for_recipients(db: Session, recipients: Iterable[str]) -> Optional[User]:
    """The person whose Cotab address the mail was sent to, if any."""
    domain = (get_settings().inbound_email_domain or "").lower()
    for raw in recipients:
        address = plain_address(raw)
        if "@" not in address:
            continue
        local, _, host = address.partition("@")
        if domain and host != domain:
            continue
        user = (
            db.query(User)
            .filter(User.inbox_alias == local, User.deleted_at.is_(None))
            .first()
        )
        if user:
            return user
    return None


# --- who may forward ----------------------------------------------------------------


def senders(db: Session, user_id: str) -> List[InboxSender]:
    return (
        db.query(InboxSender)
        .filter(InboxSender.user_id == user_id, InboxSender.deleted_at.is_(None))
        .order_by(InboxSender.created_at)
        .all()
    )


def allowed_senders(db: Session, user: User) -> List[str]:
    return [user.email.lower()] + [s.email for s in senders(db, user.id)]


def is_allowed(db: Session, user: User, from_raw: str) -> bool:
    return plain_address(from_raw) in allowed_senders(db, user)


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_email(value: str) -> bool:
    return bool(_EMAIL.match(value or "")) and len(value) <= 320


# --- webhook signatures (Resend signs with Svix) ------------------------------------


class BadSignature(Exception):
    pass


def verify_signature(
    secret: str, headers: Dict[str, str], body: bytes, now: Optional[float] = None
) -> None:
    """Check a Resend webhook the way Svix specifies.

    Signed content is "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256
    with the base64-decoded part of the secret after "whsec_", base64-encoded.
    The svix-signature header may list several "v1,<signature>" entries.
    """
    lowered = {k.lower(): v for k, v in headers.items()}
    msg_id = lowered.get("svix-id", "")
    stamp = lowered.get("svix-timestamp", "")
    given = lowered.get("svix-signature", "")
    if not (msg_id and stamp and given and secret):
        raise BadSignature("missing signature headers")
    try:
        sent_at = int(stamp)
    except ValueError:
        raise BadSignature("bad timestamp")
    if abs((now or time.time()) - sent_at) > SIGNATURE_TOLERANCE_SECONDS:
        raise BadSignature("timestamp outside tolerance")

    key_part = secret[len("whsec_") :] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(key_part)
    except Exception:
        raise BadSignature("bad secret")
    signed = f"{msg_id}.{stamp}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for entry in given.split():
        version, _, signature = entry.partition(",")
        if version == "v1" and hmac.compare_digest(signature, expected):
            return
    raise BadSignature("no matching signature")


# --- fetching from Resend -------------------------------------------------------------


def _client() -> httpx.Client:
    key = get_settings().resend_api_key or ""
    return httpx.Client(
        base_url=RESEND_API,
        headers={"Authorization": f"Bearer {key}"},
        timeout=20,
    )


def fetch_email(email_id: str) -> Dict[str, Any]:
    with _client() as c:
        r = c.get(f"/emails/receiving/{email_id}", params={"html_format": "cid"})
        r.raise_for_status()
        return r.json()


def fetch_attachments(email_id: str) -> List[Dict[str, Any]]:
    """Attachment metadata, each with a short-lived `download_url`."""
    with _client() as c:
        r = c.get(f"/emails/receiving/{email_id}/attachments")
        r.raise_for_status()
        body = r.json()
    if isinstance(body, dict):
        return list(body.get("data") or [])
    return list(body or [])


def download(url: str, limit: int) -> Optional[bytes]:
    """Download an attachment, refusing anything over `limit` bytes."""
    with httpx.Client(timeout=30, follow_redirects=True) as c:
        with c.stream("GET", url) as r:
            r.raise_for_status()
            chunks, size = [], 0
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > limit:
                    return None
                chunks.append(chunk)
    return b"".join(chunks)
