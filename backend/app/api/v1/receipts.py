import hashlib
import logging
from datetime import date, datetime, timezone
from io import BytesIO
from typing import List, Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.core.security import get_current_user
from app.db import s3 as s3_mod
from app.db.session import get_db
from app.models import Receipt, ReceiptLineItem, User
from app.schemas.schemas import ReceiptOut, ReceiptReview
from app.services import (
    ai_usage,
    budget_service,
    capture_service,
    extraction_service,
    receipt_query,
)
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.purchase_service import sync_from_receipt
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
    # Set when another receipt has the same store, total and day. The upload is
    # kept (people do buy the same thing twice); the app asks which to keep.
    possible_duplicate_of: Optional[str] = None
    # True when this receipt filled in an earlier Apple Pay tap.
    matched_tap: bool = False


def _printed_date(value: Optional[str]) -> Optional[datetime]:
    """The receipt's printed date as a moment (midday UTC), if it has one."""
    if not value:
        return None
    try:
        day = datetime.fromisoformat(value)
    except ValueError:
        return None
    if day.tzinfo is None:
        day = day.replace(hour=12, tzinfo=timezone.utc)
    return day


# Formats the scanner accepts. Phones hand over JPEG, PNG, WebP or HEIC photos;
# e-receipts and invoices usually arrive as PDFs.
ACCEPTED_TYPES = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")
PDF_TYPE = "application/pdf"


def _mime_for_key(key: str) -> str:
    """The stored file's type, from its extension (used when re-reading it)."""
    ext = (key.rsplit(".", 1)[-1] if "." in key else "").lower()
    return {
        "pdf": PDF_TYPE,
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(ext, "image/webp")


def _reject(code: str, message: str, http_status: int = 422, **extra) -> HTTPException:
    """A refusal the app can show as-is and act on by `code`."""
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message, **extra}
    )


def _near_duplicate(db: Session, receipt: Receipt) -> Optional[str]:
    """Another receipt with the same store, total and day, if there is one."""
    if not receipt.purchased_at or not receipt.total:
        return None
    day = receipt.purchased_at.date()
    candidates = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == receipt.user_id,
            Receipt.id != receipt.id,
            Receipt.deleted_at.is_(None),
            Receipt.total == receipt.total,
            Receipt.status.in_(("extracted", "reviewed")),
        )
        .all()
    )
    name = (receipt.merchant or "").strip().lower()
    for other in candidates:
        if (
            other.purchased_at
            and other.purchased_at.date() == day
            and (other.merchant or "").strip().lower() == name
        ):
            return other.id
    return None


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
    mime = (file.content_type or "").lower()
    if mime not in ACCEPTED_TYPES and mime != PDF_TYPE:
        raise _reject(
            "unsupported_type",
            "Cotab can read photos (JPEG, PNG, WebP, HEIC) and PDFs.",
            http_status=415,
        )

    _check_upload_rate_limit(user.id)

    # Read at most one byte past the cap so an oversized body is rejected
    # without buffering all of it.
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise _reject(
            "too_large",
            "This file is over 5 MB. Try a smaller photo or a shorter PDF.",
            http_status=413,
        )
    if not data:
        raise _reject("empty", "That file is empty. Try choosing it again.")

    # The exact same file twice is always a mistake.
    fingerprint = hashlib.sha256(data).hexdigest()
    existing = (
        db.query(Receipt.id)
        .filter(
            Receipt.user_id == user.id,
            Receipt.image_sha256 == fingerprint,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        raise _reject(
            "duplicate",
            "This receipt is already on your tab.",
            http_status=409,
            receipt_id=existing.id,
        )

    # Read the receipt BEFORE saving anything. A photo that isn't a readable
    # receipt is refused here and never reaches the tab or storage.
    extraction = None
    failed_message = EXTRACTION_FAILED_MESSAGE
    try:
        with ai_usage.acting_for(user.id):
            extraction = extraction_service.extract_receipt(data, mime)
    except extraction_service.ScanRejected as rejected:
        logger.info("Scan rejected (user=%s, code=%s)", user.id, rejected.code)
        raise _reject(rejected.code, rejected.message)
    except ai_usage.AILimitReached as limit:
        # Keep the photo so it can be read tomorrow with one tap.
        failed_message = (
            f"{limit.message} Your photo is saved: open it then and tap Read it again."
        )
    except Exception:
        # The AI itself failed (outage, quota, bad response), not the photo.
        # Keep the receipt so the person can retry later instead of rescanning.
        logger.exception("Receipt extraction failed (user=%s)", user.id)

    # Snapshot budget state BEFORE this receipt lands, so we can tell a newly
    # crossed threshold from one that was already breached last week.
    budgets_before = budget_service.evaluate_all(db, user.id)

    # A receipt for something already paid with an Apple Pay tap fills that
    # purchase in with its items, instead of putting it on the tab twice.
    matched_tap = None
    if extraction is not None:
        matched_tap = capture_service.find_tap_match(
            db,
            user.id,
            extraction.merchant or extraction.merchant_raw,
            extraction.total,
            _printed_date(extraction.date),
        )

    if matched_tap is not None:
        receipt = matched_tap
        tapped_at = receipt.purchased_at
        receipt.image_sha256 = fingerprint
    else:
        receipt = Receipt(
            user_id=user.id,
            status="processing",
            image_key="",
            image_sha256=fingerprint,
            source="pdf" if mime == PDF_TYPE else "photo",
        )
        db.add(receipt)
        db.commit()
        db.refresh(receipt)

    image_key = s3_mod.generate_upload_path(
        user.id,
        file.filename or ("receipt.pdf" if mime == PDF_TYPE else "receipt.webp"),
    )
    try:
        s3_mod.upload_file(image_key, BytesIO(data), mime)
    except Exception:
        # Don't fail the request if the object store is unavailable, but never
        # silently: a lost image is invisible until someone needs it.
        logger.exception("Receipt image upload failed (receipt=%s)", receipt.id)

    receipt.image_key = image_key
    if extraction is not None:
        _apply_extraction(db, receipt, user.id, extraction)
        receipt.status = "extracted"
        if matched_tap is not None and tapped_at is not None:
            # The tap knows the exact time; the receipt usually only the day.
            printed = receipt.purchased_at
            if printed is None or printed.date() == tapped_at.date():
                receipt.purchased_at = tapped_at
    else:
        receipt.status = "failed"
        receipt.error_message = failed_message

    sync_from_receipt(db, receipt)
    db.commit()
    db.refresh(receipt)

    crossed: List[dict] = []
    duplicate_of = None
    if receipt.status == "extracted":
        check_budget_alerts(db, user.id)
        crossed = budget_service.check_after_upload(db, user.id, budgets_before)
        if matched_tap is None:
            duplicate_of = _near_duplicate(db, receipt)

    return UploadResult(
        **ReceiptOut.model_validate(receipt).model_dump(),
        budget_alerts=crossed,
        possible_duplicate_of=duplicate_of,
        matched_tap=matched_tap is not None,
    )


@router.get("/", response_model=List[ReceiptOut])
def list_receipts(
    response: Response,
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
    combine; with none supplied this is the plain newest-first list.

    Paged with limit/offset. The total number of matches, across every page,
    comes back in the X-Total-Count header so the app can load more until it
    has them all (the body stays a plain list for existing clients)."""
    filters = dict(
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
    rows = receipt_query.search_receipts(
        db, user.id, limit=limit, offset=offset, **filters
    )
    # Counting is a second query, so skip it when this page already shows
    # that there is nothing beyond it.
    if offset == 0 and len(rows) < limit:
        total = len(rows)
    else:
        total = receipt_query.count_receipts(db, user.id, **filters)
    response.headers["X-Total-Count"] = str(total)
    return rows


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
    return {
        "url": s3_mod.presign_download_url(receipt.image_key),
        # The page shows photos inline and offers PDFs as a link.
        "kind": "pdf" if _mime_for_key(receipt.image_key) == PDF_TYPE else "photo",
    }


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
        with ai_usage.acting_for(user.id):
            extraction = extraction_service.extract_receipt(
                data, _mime_for_key(receipt.image_key)
            )
    except ai_usage.AILimitReached as limit:
        receipt.status = "failed"
        receipt.error_message = (
            f"{limit.message} Your photo is saved: open it then and tap Read it again."
        )
        db.commit()
        db.refresh(receipt)
        return receipt
    except extraction_service.ScanRejected as rejected:
        # Already saved from before, so keep it, but say exactly why.
        receipt.status = "failed"
        receipt.error_message = rejected.message
        db.commit()
        db.refresh(receipt)
        return receipt
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
    sync_from_receipt(db, receipt)
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
    sync_from_receipt(db, receipt)
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
    sync_from_receipt(db, receipt)
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
        sync_from_receipt(db, r)
    db.commit()
    return {"requested": len(body.receipt_ids), "updated": len(rows)}
