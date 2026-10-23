"""Push notifications to people's phones and browsers (Web Push).

The server signs every notification with a key pair it makes for itself the
first time it's needed and keeps in the database, so there is nothing to set
up on Render. A device that is gone (the person uninstalled Cotab or turned
notifications off) answers 404/410 and is forgotten.

In tests, notifications go to `sent` instead of the internet.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import AppSetting, PushSubscription

logger = logging.getLogger(__name__)

# Tests set this to a list to capture notifications instead of sending them.
sent: Optional[List[dict]] = None

CONTACT = "mailto:hello@cotab.center"


def _keys(db: Session) -> Dict[str, str]:
    """The server's signing keys: made once, then reused."""
    rows = {
        row.key: row.value
        for row in db.query(AppSetting).filter(
            AppSetting.key.in_(["vapid_private", "vapid_public"])
        )
    }
    if "vapid_private" in rows and "vapid_public" in rows:
        return {"private": rows["vapid_private"], "public": rows["vapid_public"]}
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    vapid = Vapid01()
    vapid.generate_keys()
    public = base64.urlsafe_b64encode(
        vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    ).rstrip(b"=")
    keys = {"private": vapid.private_pem().decode(), "public": public.decode()}
    db.merge(AppSetting(key="vapid_private", value=keys["private"]))
    db.merge(AppSetting(key="vapid_public", value=keys["public"]))
    db.commit()
    return keys


def public_key(db: Session) -> str:
    return _keys(db)["public"]


def _hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()


def subscribe(
    db: Session,
    user_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: Optional[str] = None,
) -> PushSubscription:
    """Remember this device for this person (moving it over if someone else
    signed in on it before)."""
    key = _hash(endpoint)
    row = db.query(PushSubscription).filter_by(endpoint_hash=key).first()
    if row is None:
        row = PushSubscription(endpoint_hash=key, endpoint=endpoint)
        db.add(row)
    row.user_id = user_id
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = (user_agent or "")[:255]
    row.deleted_at = None
    db.commit()
    return row


def unsubscribe(db: Session, user_id: str, endpoint: str) -> None:
    row = db.query(PushSubscription).filter_by(endpoint_hash=_hash(endpoint)).first()
    if row is not None and row.user_id == user_id:
        row.deleted_at = datetime.now(timezone.utc)
        db.commit()


def devices(db: Session, user_id: str) -> List[PushSubscription]:
    return (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == user_id,
            PushSubscription.deleted_at.is_(None),
        )
        .all()
    )


def can_notify(db: Session, user_id: Optional[str]) -> bool:
    return bool(user_id) and bool(devices(db, user_id))


def send(db: Session, user_id: str, title: str, body: str, url: str) -> int:
    """Notify every device this person allowed. Returns how many got it."""
    payload = json.dumps({"title": title, "body": body, "url": url})
    delivered = 0
    for device in devices(db, user_id):
        if sent is not None:
            sent.append({"user_id": user_id, "title": title, "body": body, "url": url})
            delivered += 1
            continue
        try:
            from pywebpush import WebPushException, webpush

            webpush(
                subscription_info={
                    "endpoint": device.endpoint,
                    "keys": {"p256dh": device.p256dh, "auth": device.auth},
                },
                data=payload,
                vapid_private_key=_keys(db)["private"],
                vapid_claims={"sub": CONTACT},
                ttl=60 * 60 * 24,
                timeout=10,
            )
            device.last_sent_at = datetime.now(timezone.utc)
            delivered += 1
        except WebPushException as error:
            status = getattr(error.response, "status_code", None)
            if status in (404, 410):
                device.deleted_at = datetime.now(timezone.utc)
            else:
                logger.warning("Push to a device failed (%s): %s", status, error)
        except Exception:
            logger.exception("Push to a device failed")
    db.commit()
    return delivered
