from io import BytesIO
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.core.security import get_current_user
from app.db import s3 as s3_mod
from app.db.session import get_db
from app.models import Receipt, ReceiptLineItem, User
from app.schemas.schemas import ReceiptOut, ReceiptReview
from app.services import extraction_service
from app.services.reminder_service import check_budget_alerts

settings = get_settings()
router = APIRouter(prefix="/receipts", tags=["receipts"])


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


@router.post("/upload", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
async def upload_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image uploads are supported")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail="Image too large — compress client-side first (max 300KB)",
        )

    receipt = Receipt(user_id=user.id, status="processing", image_key="")
    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    image_key = s3_mod.generate_upload_path(user.id, file.filename or "receipt.webp")
    try:
        s3_mod.upload_file(image_key, BytesIO(data), file.content_type or "image/webp")
    except Exception:
        # Don't fail the request if object store is unavailable locally
        pass

    receipt.image_key = image_key
    try:
        extraction = extraction_service.extract_receipt(
            data, file.content_type or "image/webp"
        )
        _apply_extraction(db, receipt, user.id, extraction)
        receipt.status = "extracted"
    except Exception as e:
        receipt.status = "failed"
        receipt.error_message = str(e)[:500]

    db.commit()
    db.refresh(receipt)

    if receipt.status == "extracted":
        check_budget_alerts(db, user.id)

    return receipt


@router.get("/", response_model=List[ReceiptOut])
def list_receipts(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return (
        db.query(Receipt)
        .filter(Receipt.user_id == user.id, Receipt.deleted_at.is_(None))
        .order_by(Receipt.created_at.desc())
        .all()
    )


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

    try:
        data = s3_mod.download_bytes(receipt.image_key)
        extraction = extraction_service.extract_receipt(data, "image/webp")
    except Exception as e:
        receipt.status = "failed"
        receipt.error_message = f"retry failed: {e}"[:500]
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
