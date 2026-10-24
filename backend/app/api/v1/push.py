"""Turning Cotab notifications on and off for a device."""

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User
from app.services import push_service

router = APIRouter(prefix="/push", tags=["push"])


class Keys(BaseModel):
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)


# The browsers' push services. The server posts to whatever address is
# registered, so anything else (an internal address, say) is refused.
PUSH_HOSTS = (
    "fcm.googleapis.com",
    ".push.apple.com",
    "updates.push.services.mozilla.com",
    ".notify.windows.com",
)


class Subscription(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: Keys

    @field_validator("endpoint")
    @classmethod
    def _a_push_service(cls, endpoint: str) -> str:
        url = urlsplit(endpoint)
        host = (url.hostname or "").lower()
        if url.scheme != "https" or not any(
            host == known.lstrip(".")
            or (known.startswith(".") and host.endswith(known))
            for known in PUSH_HOSTS
        ):
            raise ValueError("That isn't a browser's push address")
        return endpoint


class Endpoint(BaseModel):
    endpoint: str = Field(max_length=2000)


@router.get("/key")
def key(db: Session = Depends(get_db)):
    """The public key a browser needs to sign up for notifications."""
    return {"public_key": push_service.public_key(db)}


@router.get("/status")
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"devices": len(push_service.devices(db, user.id))}


@router.post("/subscribe")
def subscribe(
    body: Subscription,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    push_service.subscribe(
        db,
        user.id,
        body.endpoint,
        body.keys.p256dh,
        body.keys.auth,
        request.headers.get("user-agent"),
    )
    return {"devices": len(push_service.devices(db, user.id))}


@router.post("/unsubscribe")
def unsubscribe(
    body: Endpoint,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    push_service.unsubscribe(db, user.id, body.endpoint)
    return {"devices": len(push_service.devices(db, user.id))}
