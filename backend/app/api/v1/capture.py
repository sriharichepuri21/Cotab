"""Adding purchases without a receipt: the Apple Pay tap shortcut.

People manage their keys while signed in (/capture/keys). The phone's
shortcut then calls /capture/tap with one of those keys, with no session.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Receipt, User
from app.services import budget_service, capture_service, tabby_rules
from app.services.purchase_service import sync_from_receipt
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/capture", tags=["capture"])

# Generous: a busy day is a few dozen taps. This only stops a runaway loop.
TAPS_PER_HOUR = 60


class KeyIn(BaseModel):
    name: str = "iPhone"


class KeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    created_at: datetime
    last_used_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NewKeyOut(KeyOut):
    # Shown once. Only its fingerprint is stored.
    key: str


class CaptureStatus(BaseModel):
    keys: List[KeyOut]
    last_tap_at: Optional[datetime] = None
    taps_this_month: int = 0


def _refuse(http_status: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message}
    )


@router.get("/status", response_model=CaptureStatus)
def capture_status(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """What Settings shows: the keys, and whether taps are arriving."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    taps = db.query(Receipt).filter(
        Receipt.user_id == user.id,
        Receipt.source == "tap",
        Receipt.deleted_at.is_(None),
    )
    last = taps.with_entities(func.max(Receipt.created_at)).scalar()
    this_month = taps.filter(Receipt.created_at >= month_start).count()
    return CaptureStatus(
        keys=[
            KeyOut.model_validate(k) for k in capture_service.active_keys(db, user.id)
        ],
        last_tap_at=last,
        taps_this_month=this_month,
    )


@router.post("/keys", response_model=NewKeyOut, status_code=status.HTTP_201_CREATED)
def create_key(
    body: KeyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(capture_service.active_keys(db, user.id)) >= capture_service.MAX_KEYS:
        raise _refuse(
            409,
            "too_many_keys",
            f"You can have {capture_service.MAX_KEYS} keys. Remove one you no longer use first.",
        )
    row, plain = capture_service.create_key(db, user.id, body.name)
    return NewKeyOut(**KeyOut.model_validate(row).model_dump(), key=plain)


@router.delete("/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_key(
    key_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = next(
        (k for k in capture_service.active_keys(db, user.id) if k.id == key_id), None
    )
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _field(body: Dict[str, Any], *names: str) -> Any:
    """Shortcuts sends whatever names the person typed; accept the obvious ones."""
    lowered = {str(k).strip().lower(): v for k, v in body.items()}
    for name in names:
        if name in lowered and lowered[name] not in (None, ""):
            return lowered[name]
    return None


@router.post("/tap")
def capture_tap(
    response: Response,
    body: Optional[Any] = Body(None),
    authorization: Optional[str] = Header(None),
    x_cotab_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Called by the Apple Pay shortcut each time the person pays.

    Answers with one short sentence in `message`, which the shortcut can show
    as a notification ("Starbucks $5.75 is on your tab").
    """
    plain = x_cotab_key or ""
    if authorization and authorization.lower().startswith("bearer "):
        plain = authorization[7:].strip()
    key = capture_service.key_owner(db, plain)
    if not key:
        raise _refuse(
            401,
            "bad_key",
            "This Cotab key isn't valid any more. Make a new one in Cotab Settings.",
        )
    user_id = key.user_id

    try:
        check_rate_limit("tap", user_id, TAPS_PER_HOUR)
    except RateLimitExceeded:
        raise _refuse(429, "too_many", "Too many taps in an hour. Try again later.")
    except RateLimitUnavailable:
        raise _refuse(503, "unavailable", "Cotab is busy. This tap wasn't saved.")

    if not isinstance(body, dict):
        raise _refuse(422, "bad_body", "The shortcut didn't send a store and amount.")

    amount, currency = capture_service.parse_amount(
        _field(body, "amount", "total", "price")
    )
    if amount is None or amount <= 0:
        raise _refuse(
            422,
            "no_amount",
            "The shortcut didn't send an amount. Check its Amount field in Shortcuts.",
        )
    raw_merchant = str(_field(body, "merchant", "store", "name") or "")
    merchant = capture_service.clean_merchant(raw_merchant)
    now = datetime.now(timezone.utc)

    key.last_used_at = now
    existing = capture_service.recent_same_tap(db, user_id, merchant, amount, now)
    if existing:
        db.commit()
        response.status_code = status.HTTP_200_OK
        return {
            "ok": True,
            "duplicate": True,
            "receipt_id": existing.id,
            "message": f"{merchant} is already on your tab.",
        }

    budgets_before = budget_service.evaluate_all(db, user_id)
    currency = (currency or capture_service.home_currency(db, user_id)).upper()[:3]
    receipt = Receipt(
        user_id=user_id,
        source="tap",
        status="reviewed",  # straight from the bank card: nothing for a person to check
        merchant=merchant,
        merchant_raw=raw_merchant[:255],
        total=round(amount, 2),
        subtotal=round(amount, 2),
        tax=0.0,
        currency=currency,
        category=capture_service.guess_category(db, user_id, merchant),
        confidence=1.0,
        extraction_method="tap",
        purchased_at=now,
        image_key="",
    )
    db.add(receipt)
    db.flush()
    sync_from_receipt(db, receipt)
    db.commit()
    db.refresh(receipt)

    tabby_rules.on_new_receipt(db, user_id, receipt)
    crossed = budget_service.check_after_upload(db, user_id, budgets_before)
    message = f"{merchant} {currency} {receipt.total:.2f} is on your tab."
    if currency == "USD":
        message = f"{merchant} ${receipt.total:.2f} is on your tab."
    if crossed:
        worst = crossed[0]
        message += (
            f" {worst['label']} is at {round(worst['percent_used'])}% of its budget."
        )
    response.status_code = status.HTTP_201_CREATED
    return {
        "ok": True,
        "duplicate": False,
        "receipt_id": receipt.id,
        "message": message,
    }
