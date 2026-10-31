"""Alerts for whoever runs Cotab: things a person can't fix on their own.

- a Tabby step whose undo failed, so money may not be where the app says
- a step that reaches outside the app (a push) and stopped part-way
- AI spend nearing, or reaching, the app-wide daily cap

Every alert is logged at ERROR (so log-based monitoring picks it up) and, when
OPS_ALERT_EMAIL and email sending are configured, emailed. The same alert is
sent at most once per hour per key, so a stuck run can't flood the inbox.
Never raises: an alert that can't go out must not break the request.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional

import httpx

from app.config.settings import get_settings

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 3600

# Tests set this to a list to capture alerts instead of sending them.
sent: Optional[List[Dict[str, str]]] = None

_last: Dict[str, float] = {}
_lock = threading.Lock()


def _reset_for_tests() -> None:
    with _lock:
        _last.clear()


def alert(kind: str, message: str, key: str = "") -> bool:
    """Raise an operator alert. Returns False when it was a recent repeat."""
    dedupe = f"{kind}:{key}"
    now = time.monotonic()
    with _lock:
        last = _last.get(dedupe)
        if last is not None and now - last < COOLDOWN_SECONDS:
            return False
        _last[dedupe] = now
    logger.error("OPS ALERT [%s] %s", kind, message)
    if sent is not None:
        sent.append({"kind": kind, "key": key, "message": message})
        return True
    try:
        _email(kind, message)
    except Exception:
        logger.exception("Couldn't email an ops alert (%s)", kind)
    return True


def _email(kind: str, message: str) -> None:
    settings = get_settings()
    if not settings.ops_alert_email or not settings.email_sending_enabled():
        return
    from app.services import email_verification

    response = httpx.post(
        f"{email_verification.RESEND_API}/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.email_from,
            "to": [settings.ops_alert_email],
            "subject": f"[Cotab alert] {kind}",
            "text": message,
        },
        timeout=15,
    )
    if response.status_code >= 300:
        logger.error("Resend refused an ops alert: %s", response.text)
