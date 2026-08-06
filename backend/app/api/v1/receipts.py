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
from app.services import gemini_service
from app.services.reminder_service import check_budget_alerts

settings = get_settings()
router = APIRouter(prefix="/receipts", tags=["receipts"])


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
        extraction = gemini_service.extract_receipt_from_image(
            data, file.content_type or "image/webp"
        )
        receipt.merchant = extraction.merchant
        receipt.merchant_raw = extraction.merchant_raw
        receipt.total = extraction.total
        receipt.subtotal = extraction.subtotal
        receipt.tax = extraction.tax
        receipt.currency = extraction.currency
        receipt.category = extraction.category
        receipt.confidence = extraction.confidence
        if extraction.date:
            from datetime import datetime
            try:
                receipt.purchased_at = datetime.fromisoformat(extraction.date)
            except ValueError:
                pass
        receipt.status = "extracted"

        for li in extraction.line_items:
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
    except Exception as e:
        receipt.status = "failed"
        receipt.error_message = str(e)[:500]

    db.commit()
    db.refresh(receipt)

    if receipt.status == "extracted":
        check_budget_alerts(db, user.id)

    return receipt


@router.get("/", response_model=List[ReceiptOut])
def list_receipts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
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
    receipt_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
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


@router.post("/{receipt_id}/review", response_model=ReceiptOut)
def review_receipt(
    receipt_id: str,
    body: ReceiptReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
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

    if body.merchant is not None:
        receipt.merchant = body.merchant
    if body.purchased_at is not None:
        receipt.purchased_at = body.purchased_at
    if body.total is not None:
        receipt.total = body.total
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
    receipt_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    from datetime import datetime, timezone
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
    receipt.deleted_at = datetime.now(timezone.utc)
    db.commit()
