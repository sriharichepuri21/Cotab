"""Email verification: a 6-digit code Tabby emails to every new account.

Only an HMAC of the code is stored, keyed with the app secret and the user's
id, so a database leak doesn't hand out working codes. A code expires after
`verify_code_minutes`, and after `verify_max_attempts` wrong tries it stops
working until a new one is sent. New codes can be sent once a minute.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import User

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com"


class VerifyError(Exception):
    """A code that can't be accepted. `code` says why, for the API to map."""

    def __init__(self, code: str, message: str, retry_after: int = 0):
        self.code = code
        self.message = message
        self.retry_after = retry_after
        super().__init__(message)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _hash(user: User, code: str, purpose: str = "verify") -> str:
    """The purpose is part of the hash, so a sign-up code can't confirm a
    deletion or the other way round."""
    key = get_settings().secret_key.encode()
    message = f"{purpose}:{user.id}:{code}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# --- sending ---------------------------------------------------------------

# Tests swap this for a list; production posts to Resend.
Sender = Callable[[str, str, str, str], None]
outbox: Optional[List[dict]] = None


_WHY = {
    "verify": (
        "Type it in the app to confirm this email.",
        "Here's your code to confirm this email. Type it in the app.",
        "If you didn't sign up for Cotab, you can ignore this email.",
    ),
    "delete": (
        "Type it in the app to delete your Cotab account.",
        "Here's your code to delete your Cotab account. Type it in the app.",
        "If you didn't ask to delete your account, ignore this email. Nothing changes without the code.",
    ),
}


def _email_body(
    name: str, code: str, minutes: int, purpose: str = "verify"
) -> tuple[str, str]:
    plain_why, html_why, ignore = _WHY[purpose]
    hello = f"Hi {html.escape(name)}," if name else "Hi,"
    text = (
        f"{'Hi ' + name + ',' if name else 'Hi,'}\n\n"
        f"Your Cotab code is {code}\n\n"
        f"{plain_why} It works for {minutes} minutes.\n"
        f"{ignore}\n\n"
        "Tabby, from Cotab"
    )
    spaced = " ".join(code)
    page = f"""<!doctype html><html><body style="margin:0;background:#F3F4F1;font-family:Manrope,Helvetica,Arial,sans-serif;color:#0C110E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border-radius:24px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-0.5px">cotab</p>
<p style="margin:24px 0 8px;font-size:16px">{hello}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">{html_why}</p>
<p style="margin:0 0 20px;padding:18px 0;border-radius:16px;background:#0F3D31;color:#D7F45B;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px">{spaced}</p>
<p style="margin:0 0 6px;font-size:14px;color:#5D6560">It works for {minutes} minutes.</p>
<p style="margin:0;font-size:14px;color:#5D6560">{html.escape(ignore)}</p>
<p style="margin:24px 0 0;font-size:14px;font-weight:700">Tabby, from Cotab</p>
</td></tr></table></td></tr></table></body></html>"""
    return text, page


def send_code_email(to: str, name: str, code: str, purpose: str = "verify") -> None:
    settings = get_settings()
    minutes = settings.verify_code_minutes
    subject = (
        f"{code} is your Cotab code"
        if purpose == "verify"
        else f"{code} confirms deleting your Cotab account"
    )
    text, page = _email_body(name, code, minutes, purpose)
    if outbox is not None:
        outbox.append(
            {
                "to": to,
                "subject": subject,
                "code": code,
                "text": text,
                "purpose": purpose,
            }
        )
        return
    if not settings.email_sending_enabled():
        if settings.is_production():
            raise VerifyError(
                "unavailable",
                "We can't send emails right now. Please try again later.",
            )
        logger.warning("Email sending is off. Verification code for %s: %s", to, code)
        return
    response = httpx.post(
        f"{RESEND_API}/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.email_from,
            "to": [to],
            "subject": subject,
            "text": text,
            "html": page,
        },
        timeout=15,
    )
    if response.status_code >= 300:
        logger.error(
            "Resend refused a code email: %s %s", response.status_code, response.text
        )
        raise VerifyError(
            "unavailable", "We couldn't send the email just now. Try again in a minute."
        )


# --- the flow --------------------------------------------------------------


def send_code(
    db: Session, user: User, force: bool = False, purpose: str = "verify"
) -> int:
    """Email a fresh code. Returns seconds until another may be sent.

    Raises VerifyError("too_soon") inside the resend window unless `force`."""
    settings = get_settings()
    now = _now()
    sent = _aware(user.verify_sent_at)
    wait = settings.verify_resend_seconds
    if not force and sent and (now - sent).total_seconds() < wait:
        left = int(wait - (now - sent).total_seconds()) + 1
        raise VerifyError("too_soon", f"Wait {left} seconds for a new code.", left)
    code = new_code()
    user.verify_code_hash = _hash(user, code, purpose)
    user.verify_expires_at = now + timedelta(minutes=settings.verify_code_minutes)
    user.verify_attempts = 0
    user.verify_sent_at = now
    db.commit()
    send_code_email(user.email, (user.full_name or "").split(" ")[0], code, purpose)
    return wait


def check_code(db: Session, user: User, code: str) -> None:
    """Mark the email verified, or raise VerifyError saying why not."""
    if user.email_verified:
        return
    _match(db, user, code, "verify")
    user.email_verified = True
    db.commit()


def check_action_code(db: Session, user: User, code: str, purpose: str) -> None:
    """Accept a code sent for one action (e.g. deleting the account)."""
    _match(db, user, code, purpose)
    db.commit()


def _match(db: Session, user: User, code: str, purpose: str) -> None:
    settings = get_settings()
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    if not user.verify_code_hash:
        raise VerifyError("no_code", "Send yourself a code first.")
    if (user.verify_attempts or 0) >= settings.verify_max_attempts:
        raise VerifyError("locked", "Too many wrong codes. Send yourself a new one.")
    expires = _aware(user.verify_expires_at)
    if expires is None or expires < _now():
        raise VerifyError("expired", "That code has expired. Send yourself a new one.")
    if len(code) != 6 or not hmac.compare_digest(
        user.verify_code_hash, _hash(user, code, purpose)
    ):
        user.verify_attempts = (user.verify_attempts or 0) + 1
        db.commit()
        left = settings.verify_max_attempts - user.verify_attempts
        if left <= 0:
            raise VerifyError(
                "locked", "Too many wrong codes. Send yourself a new one."
            )
        raise VerifyError(
            "wrong",
            f"That code isn't right. {left} tr{'ies' if left != 1 else 'y'} left.",
        )
    user.verify_code_hash = None
    user.verify_expires_at = None
    user.verify_attempts = 0
