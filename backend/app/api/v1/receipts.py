import hashlib
import logging
from collections import defaultdict, deque
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
from app.models import (
    Receipt,
    ReceiptLineItem,
    SplitItemAssignment,
    User,
)
from app.schemas.schemas import ReceiptOut, ReceiptReview
from app.services import (
    notify,
    price_memory,
    receipt_query,
    scan_service,
    split_service,
)
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.purchase_service import sync_from_receipt
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/receipts", tags=["receipts"])

EXTRACTION_FAILED_MESSAGE = scan_service.EXTRACTION_FAILED_MESSAGE
_mime_for_key = scan_service.mime_for_key


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


# Formats the scanner accepts. Phones hand over JPEG, PNG, WebP or HEIC photos;
# e-receipts and invoices usually arrive as PDFs.
ACCEPTED_TYPES = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")
PDF_TYPE = "application/pdf"


def _reject(code: str, message: str, http_status: int = 422, **extra) -> HTTPException:
    """A refusal the app can show as-is and act on by `code`."""
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message, **extra}
    )


class ScanResult(BaseModel):
    """Where a scan has got to, for the app to poll.

    `state`: "reading" (still going), "added" (on the tab), "joined" (filled
    in an Apple Pay tap; `receipt` is the tap), "refused" (not a receipt or
    unreadable; nothing was kept), or "failed" (kept; can be read again).
    """

    id: str
    state: str
    receipt: Optional[ReceiptOut] = None
    code: Optional[str] = None
    message: str = ""
    budget_alerts: List[dict] = []
    possible_duplicate_of: Optional[str] = None


def _scan_result(db: Session, receipt: Receipt) -> ScanResult:
    found = scan_service.info(receipt)
    if receipt.status == "processing":
        return ScanResult(id=receipt.id, state="reading")
    if receipt.status == "rejected":
        return ScanResult(
            id=receipt.id,
            state="refused",
            code=found.get("rejected") or "no_total",
            message=receipt.error_message or "",
        )
    if receipt.status == "merged":
        tap = db.get(Receipt, found.get("merged_into"))
        return ScanResult(
            id=receipt.id,
            state="joined",
            receipt=ReceiptOut.model_validate(tap) if tap else None,
            budget_alerts=(
                scan_service.info(tap).get("budget_alerts", []) if tap else []
            ),
        )
    if receipt.status == "failed":
        return ScanResult(
            id=receipt.id,
            state="failed",
            receipt=ReceiptOut.model_validate(receipt),
            message=receipt.error_message or "",
        )
    return ScanResult(
        id=receipt.id,
        state="joined" if found.get("matched_tap") else "added",
        receipt=ReceiptOut.model_validate(receipt),
        budget_alerts=found.get("budget_alerts", []),
        possible_duplicate_of=found.get("possible_duplicate_of"),
    )


@router.post(
    "/upload", response_model=UploadResult, status_code=status.HTTP_201_CREATED
)
def upload_receipt(
    file: UploadFile = File(...),
    wait: bool = Query(
        False, description="Read it before answering (slower; for API clients)"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Save the scan and answer straight away; it is read in the background.

    The answer is the new receipt with status "processing"; poll
    `GET /receipts/{id}/scan` for the outcome. With `wait=true` (and in tests)
    the read happens first and the answer is the finished receipt, or a 422
    refusal for something that isn't a receipt.
    """
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

    image_key = s3_mod.generate_upload_path(
        user.id,
        file.filename or ("receipt.pdf" if mime == PDF_TYPE else "receipt.webp"),
    )
    try:
        s3_mod.upload_file(image_key, BytesIO(data), mime)
    except Exception:
        # Don't fail the request if the object store is unavailable, but never
        # silently: a lost image is invisible until someone needs it.
        logger.exception("Receipt image upload failed (user=%s)", user.id)

    receipt = Receipt(
        user_id=user.id,
        status="processing",
        image_key=image_key,
        image_sha256=fingerprint,
        source="pdf" if mime == PDF_TYPE else "photo",
        reading_since=datetime.now(timezone.utc),
        # Until the printed date is read, file it under when it was scanned,
        # so it shows at the top of the tab rather than under "No date".
        purchased_at=datetime.now(timezone.utc),
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    if scan_service.in_background() and not wait:
        scan_service.submit(receipt.id, data, mime)
        return UploadResult(**ReceiptOut.model_validate(receipt).model_dump())

    outcome = scan_service.read(db, receipt.id, data, mime)
    if outcome is None:  # pragma: no cover - only if it vanished meanwhile
        raise HTTPException(status_code=404, detail="Receipt not found")
    if outcome.rejected_code:
        # Nobody needs to poll for this one: leave no trace of it at all.
        db.delete(outcome.receipt)
        db.commit()
        raise _reject(outcome.rejected_code, outcome.rejected_message)
    return UploadResult(
        **ReceiptOut.model_validate(outcome.receipt).model_dump(),
        budget_alerts=outcome.budget_alerts,
        possible_duplicate_of=outcome.possible_duplicate_of,
        matched_tap=outcome.matched_tap,
    )


@router.get("/{receipt_id}/scan", response_model=ScanResult)
def scan_status(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Where a scan has got to. Includes scans that were refused or joined a
    tap (their own row is gone from the tab), and restarts a lost one."""
    receipt = (
        db.query(Receipt)
        .filter(Receipt.id == receipt_id, Receipt.user_id == user.id)
        # Polled while a worker writes it: always read the latest row.
        .populate_existing()
        .first()
    )
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if receipt.deleted_at and receipt.status not in ("rejected", "merged"):
        raise HTTPException(status_code=404, detail="Receipt not found")
    if scan_service.claim_if_stuck(db, receipt):
        scan_service.submit(receipt.id)
        db.refresh(receipt)
    return _scan_result(db, receipt)


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


@router.get("/{receipt_id}/prices")
def get_receipt_prices(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Each item on this receipt next to what you paid for it before at the
    same store, plus Tabby's one-line take."""
    return price_memory.for_receipt(db, _get_owned_receipt(db, user, receipt_id))


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
    receipt.status = "processing"
    receipt.reading_since = datetime.now(timezone.utc)
    db.commit()
    # Already on the tab from before: a refusal keeps it, with the reason.
    scan_service.read(db, receipt.id, keep_if_refused=True)
    db.refresh(receipt)
    if receipt.status == "merged":
        tap = db.get(Receipt, scan_service.info(receipt).get("merged_into"))
        if tap is not None:
            return tap
    return receipt


@router.post("/{receipt_id}/review", response_model=ReceiptOut)
def review_receipt(
    receipt_id: str,
    body: ReceiptReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    receipt = _get_owned_receipt(db, user, receipt_id)
    old_total = receipt.total

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
        # Corrections don't send the product number or size back, so keep what
        # was read for any line that is still the same line.
        before = {
            line.id: line
            for line in db.query(ReceiptLineItem).filter(
                ReceiptLineItem.receipt_id == receipt.id
            )
        }
        # Lines still there are updated in place, not deleted and re-added:
        # split item picks point at them, so they keep counting. A line sent
        # without its id is matched to an unclaimed one that reads the same.
        sent = {li.id for li in body.line_items if li.id in before}
        unclaimed = defaultdict(deque)
        for line in before.values():
            if line.id not in sent:
                unclaimed[split_service.same_item(line)].append(line)
        matched = []
        for li in body.line_items:
            old = before.get(li.id or "")
            if old is None:
                pool = unclaimed[price_memory.item_key(None, li.description)]
                old = pool.popleft() if pool else None
            matched.append((li, old))
        gone = set(before) - {old.id for _, old in matched if old is not None}
        db.query(SplitItemAssignment).filter(
            SplitItemAssignment.line_item_id.in_(gone)
        ).delete(synchronize_session=False)
        db.query(ReceiptLineItem).filter(ReceiptLineItem.id.in_(gone)).delete(
            synchronize_session=False
        )
        for li, old in matched:
            line = price_memory.make_line(receipt.id, user.id, li)
            if old is not None and (old.item_code or old.item_name):
                fields = price_memory.line_fields(
                    li.description,
                    old.item_code,
                    old.item_name if old.description == li.description else None,
                )
                for field, value in fields.items():
                    setattr(line, field, value)
            if old is not None:
                line.id = old.id
                db.merge(line)
            else:
                db.add(line)

    receipt.status = "reviewed"
    sync_from_receipt(db, receipt)
    # Shares on its tabs follow a corrected total ($77 that was really $17).
    resplit = (
        split_service.reshare(db, receipt)
        if receipt.total != old_total or body.line_items is not None
        else []
    )
    db.commit()
    notify.splits_changed(db, receipt, user.id, resplit)
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
