import logging
from datetime import date
from io import BytesIO
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.core.security import get_current_user
from app.db import s3 as s3_mod
from app.db.session import get_db
from app.models import Receipt, ReceiptLineItem, User
from app.schemas.schemas import ReceiptOut, ReceiptReview
from app.services import budget_service, extraction_service, receipt_query
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)
from app.services.reminder_service import check_budget_alerts

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/receipts", tags=["receipts"])

# Shown to the user when extraction fails. The real exception is logged
# server-side only: provider and database errors can contain internal
# details (hostnames, SQL, API messages) that must not reach the browser.
EXTRACTION_FAILED_MESSAGE = (
    "We couldn't read this receipt. Try retrying, or enter the details by hand."
)


def _check_upload_rate_limit(user_id: str) -> None:
    """Every upload is a paid vision call, so cap it per user."""
    try:
        check_rate_limit("upload", user_id, settings.rate_limit_upload_per_hour)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many uploads. Please wait a bit and try again.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    except RateLimitUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Uploads are temporarily unavailable. Please try again soon.",
        )


def _apply_extraction(db: Session, receipt: Receipt, user_id: str, extraction) -> None:
    """Write an extraction onto a receipt row: replace fields + line items.

    extraction is a gemini_service.ReceiptExtraction from either the rules path
    or the LLM; `extraction_method` records which. Caller commits.
    """
    receipt.merchant = extraction.merchant
    receipt.merchant_raw = extraction.merchant_raw
    receipt.total = extraction.total
    receipt.subtotal = extraction.subtotal
    receipt.tax = extraction.tax
    receipt.currency = extraction.currency
    receipt.category = extraction.category
    receipt.confidence = extraction.confidence
    receipt.extraction_method = extraction.extraction_method
    if extraction.date:
        from datetime import datetime

        try:
            receipt.purchased_at = datetime.fromisoformat(extraction.date)
        except ValueError:
            pass
    db.query(ReceiptLineItem).filter(ReceiptLineItem.receipt_id == receipt.id).delete()
    for li in extraction.line_items:
        db.add(
            ReceiptLineItem(
                receipt_id=receipt.id,
                user_id=user_id,
                description=li.description,
                quantity=li.quantity,
                unit_price=li.unit_price,
                total_price=li.total_price,
            )
        )


def _get_owned_receipt(db: Session, user: User, receipt_id: str) -> Receipt:
    """Fetch a receipt owned by the caller, or 404. Single soft-delete-aware query."""
    receipt = (
        db.query(Receipt)
        .filter(
            Receipt.id == receipt_id,
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


class UploadResult(ReceiptOut):
    """ReceiptOut plus any budget thresholds this upload just crossed.

    Extends rather than wraps, so every existing client that reads `.status` or
    `.total` off the upload response keeps working — nesting the receipt under a
    key would have been a silent breaking change for no benefit.

    Returned with the upload rather than via a second endpoint: the toast has to
    appear with the upload that caused it, and a follow-up request would race the
    user navigating away.
    """

    budget_alerts: List[dict] = []


@router.post(
    "/upload", response_model=UploadResult, status_code=status.HTTP_201_CREATED
)
def upload_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # A plain `def` (not `async def`) on purpose: extraction makes a blocking
    # Gemini call and the DB session is synchronous. FastAPI runs sync handlers
    # in a thread pool; as `async def` this blocked the event loop, stalling
    # every other user's request for the length of the Gemini call.
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image uploads are supported")

    _check_upload_rate_limit(user.id)

    # Read at most one byte past the cap so an oversized body is rejected
    # without buffering all of it.
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail="Image too large for upload (over 5MB) — please try a smaller photo",
        )

    # Snapshot budget state BEFORE this receipt lands, so we can tell a newly
    # crossed threshold from one that was already breached last week.
    budgets_before = budget_service.evaluate_all(db, user.id)

    receipt = Receipt(user_id=user.id, status="processing", image_key="")
    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    image_key = s3_mod.generate_upload_path(user.id, file.filename or "receipt.webp")
    try:
        s3_mod.upload_file(image_key, BytesIO(data), file.content_type or "image/webp")
    except Exception:
        # Don't fail the request if the object store is unavailable, but never
        # silently: a lost image is invisible until someone needs it.
        logger.exception("Receipt image upload failed (receipt=%s)", receipt.id)

    receipt.image_key = image_key
    try:
        extraction = extraction_service.extract_receipt(
            data, file.content_type or "image/webp"
        )
        _apply_extraction(db, receipt, user.id, extraction)
        receipt.status = "extracted"
    except Exception:
        logger.exception("Receipt extraction failed (receipt=%s)", receipt.id)
        receipt.status = "failed"
        receipt.error_message = EXTRACTION_FAILED_MESSAGE

    db.commit()
    db.refresh(receipt)

    crossed: List[dict] = []
    if receipt.status == "extracted":
        check_budget_alerts(db, user.id)
        crossed = budget_service.check_after_upload(db, user.id, budgets_before)

    return UploadResult(
        **ReceiptOut.model_validate(receipt).model_dump(), budget_alerts=crossed
    )


@router.get("/", response_model=List[ReceiptOut])
def list_receipts(
    q: Optional[str] = Query(None, description="Search merchant AND line items"),
    category: Optional[str] = None,
    merchant: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[date] = None,
    end_date: Optional[date] = Query(None, description="Inclusive"),
    min_amount: Optional[float] = Query(None, ge=0),
    max_amount: Optional[float] = Query(None, ge=0),
    sort: str = Query("date", pattern="^(date|amount|merchant|created)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Filtered, searchable receipt list. Every parameter is optional and they
    combine; with none supplied this is the plain newest-first list."""
    return receipt_query.search_receipts(
        db,
        user.id,
        limit=limit,
        offset=offset,
        q=q,
        category=category,
        merchant=merchant,
        status=status_filter,
        start_date=start_date,
        end_date=end_date,
        min_amount=min_amount,
        max_amount=max_amount,
        sort=sort,
        order=order,
    )


@router.get("/facets")
def facets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Distinct categories/merchants/statuses present in this user's receipts,
    so the filter dropdowns only offer values that can actually return rows."""
    return receipt_query.filter_facets(db, user.id)


@router.get("/review-queue", response_model=List[ReceiptOut])
def review_queue(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Human-in-the-loop queue: extracted-but-not-yet-reviewed receipts."""
    return (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
            Receipt.status == "extracted",
        )
        .order_by(Receipt.confidence.asc())
        .all()
    )


@router.get("/{receipt_id}", response_model=ReceiptOut)
def get_receipt(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _get_owned_receipt(db, user, receipt_id)


@router.get("/{receipt_id}/image")
def get_receipt_image(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Short-lived presigned URL for the receipt image.

    The image is private S3/Supabase storage; this returns a presigned URL that
    lets the owner render it in the detail page without exposing the raw key.

    Honest failure mode: when storage falls back to the local filesystem the
    "presigned URL" is a `local://` pointer a browser can't load, so we answer
    501 (not implemented) instead of returning a broken URL. The detail page
    treats 404/501 the same — no preview.
    """
    receipt = _get_owned_receipt(db, user, receipt_id)
    if not receipt.image_key:
        raise HTTPException(status_code=404, detail="No image for this receipt")

    # Presigning signs locally and never touches the network, so a broken/local
    # endpoint still yields a syntactically valid URL. The honest signal is config:
    # when storage is a local dev endpoint (LocalStack) the image is not reachable
    # by the deployed frontend, so 501 tells the UI "no web preview" instead of
    # handing back a URL that will just fail to load in the browser.
    endpoint = (settings.s3_endpoint_url or "").lower()
    if endpoint and (
        "localhost" in endpoint or "127.0.0.1" in endpoint or "::1" in endpoint
    ):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Receipt image is on a local dev object store; no web-accessible preview in this environment.",
        )
    return {"url": s3_mod.presign_download_url(receipt.image_key)}


@router.post("/{receipt_id}/retry", response_model=ReceiptOut)
def retry_extraction(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Re-run Gemini extraction on the stored image.

    Only meaningfully valid on receipts whose extraction failed or never finished
    (`failed` / `processing`). Refused on `extracted`/`reviewed` to avoid silently
    clobbering good or human-confirmed data — a true re-extract of a clean receipt
    can come later behind a `force` flag if it's ever needed.
    """
    receipt = _get_owned_receipt(db, user, receipt_id)
    if receipt.status in ("extracted", "reviewed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Receipt is already '{receipt.status}'; retry would overwrite it.",
        )
    if not receipt.image_key:
        raise HTTPException(status_code=404, detail="No image for this receipt")

    _check_upload_rate_limit(user.id)
    try:
        data = s3_mod.download_bytes(receipt.image_key)
        extraction = extraction_service.extract_receipt(data, "image/webp")
    except Exception:
        logger.exception("Receipt extraction retry failed (receipt=%s)", receipt.id)
        receipt.status = "failed"
        receipt.error_message = EXTRACTION_FAILED_MESSAGE
        db.commit()
        db.refresh(receipt)
        return receipt

    _apply_extraction(db, receipt, user.id, extraction)
    receipt.status = "extracted"
    receipt.error_message = ""
    db.commit()
    db.refresh(receipt)
    return receipt


@router.post("/{receipt_id}/review", response_model=ReceiptOut)
def review_receipt(
    receipt_id: str,
    body: ReceiptReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    receipt = _get_owned_receipt(db, user, receipt_id)

    if body.merchant is not None:
        receipt.merchant = body.merchant
    if body.purchased_at is not None:
        receipt.purchased_at = body.purchased_at
    if body.total is not None:
        receipt.total = body.total
    if body.subtotal is not None:
        receipt.subtotal = body.subtotal
    if body.tax is not None:
        receipt.tax = body.tax
    if body.currency is not None:
        receipt.currency = body.currency
    if body.category is not None:
        receipt.category = body.category

    if body.line_items is not None:
        db.query(ReceiptLineItem).filter(
            ReceiptLineItem.receipt_id == receipt.id
        ).delete()
        for li in body.line_items:
            db.add(
                ReceiptLineItem(
                    receipt_id=receipt.id,
                    user_id=user.id,
                    description=li.description,
                    quantity=li.quantity,
                    unit_price=li.unit_price,
                    total_price=li.total_price,
                )
            )

    receipt.status = "reviewed"
    db.commit()
    db.refresh(receipt)
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone

    receipt = _get_owned_receipt(db, user, receipt_id)
    receipt.deleted_at = datetime.now(timezone.utc)
    db.commit()


class BulkAction(BaseModel):
    receipt_ids: List[str] = Field(min_length=1, max_length=500)
    action: Literal["categorize", "delete"]
    category: Optional[str] = None


@router.post("/bulk")
def bulk_action(
    body: BulkAction,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply one action to many receipts.

    Ownership is enforced by filtering on user_id rather than by looking each id
    up and trusting it: an id belonging to someone else simply doesn't match, so
    a forged list silently affects nothing instead of leaking that the receipt
    exists. `updated` reports what actually changed, which is how the caller
    learns some ids were skipped.
    """
    from datetime import datetime, timezone

    if body.action == "categorize":
        cat = _normalize_category(body.category)
        if not cat:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown category. Try one of: {', '.join(CANONICAL_CATEGORIES)}",
            )

    rows = (
        db.query(Receipt)
        .filter(
            Receipt.id.in_(body.receipt_ids),
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
        )
        .all()
    )

    for r in rows:
        if body.action == "delete":
            r.deleted_at = datetime.now(timezone.utc)
        else:
            r.category = cat
    db.commit()
    return {"requested": len(body.receipt_ids), "updated": len(rows)}
