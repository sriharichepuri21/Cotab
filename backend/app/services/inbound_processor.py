"""Turn one forwarded email into a purchase on the tab.

Runs in the background after the webhook has answered, so Resend never waits
on the AI. Every outcome is written to the email's InboundEmail row, which is
what the person sees under "Recent emails" in Settings: there is no reply
email, so that list is how they learn what happened.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.db import s3 as s3_mod
from app.db.session import SessionLocal
from app.models import InboundEmail, Receipt, ReceiptLineItem, User
from app.services import (
    ai_usage,
    budget_service,
    capture_service,
    email_reader,
    extraction_service,
    inbox_service,
    price_memory,
)
from app.services.gemini_service import ReceiptExtraction
from app.services.purchase_service import sync_from_receipt

logger = logging.getLogger(__name__)

# Attachments that can be the receipt itself. Small inline images are logos.
RECEIPT_ATTACHMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
}
MIN_IMAGE_BYTES = 30_000


def _finish(
    db: Session, row: InboundEmail, status: str, reason: str = "", receipt_id=None
):
    row.status = status
    row.reason = reason[:512]
    row.receipt_id = receipt_id
    db.commit()


def _authenticated(message: Dict[str, Any]) -> bool:
    """The forwarding mailbox proved it sent this (any of SPF, DKIM, DMARC)."""
    auth = message.get("authentication") or {}
    if not auth:
        # Resend didn't report checks: don't block, the sender list still applies.
        return True
    return any(str(auth.get(k, "")).lower() == "pass" for k in ("dkim", "spf", "dmarc"))


def _pick_attachment(attachments: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The attachment most likely to be the receipt: a PDF first, else a
    sizeable photo that isn't an inline logo."""
    usable = [
        a
        for a in attachments
        if (a.get("content_type") or "").lower() in RECEIPT_ATTACHMENT_TYPES
    ]
    pdfs = [a for a in usable if a["content_type"].lower() == "application/pdf"]
    if pdfs:
        return pdfs[0]
    photos = [
        a
        for a in usable
        if (a.get("content_disposition") or "").lower() != "inline"
        and (a.get("size") or 0) >= MIN_IMAGE_BYTES
    ]
    return max(photos, key=lambda a: a.get("size") or 0) if photos else None


def _from_code(code: email_reader.CodeReading) -> ReceiptExtraction:
    """A receipt from the plain-code reading alone (no items)."""
    return ReceiptExtraction(
        merchant=code.merchant,
        merchant_raw=code.merchant,
        total=code.total or 0,
        subtotal=code.total or 0,
        currency=code.currency or "USD",
        date=code.when.isoformat() if code.when else None,
        confidence=0.8 if code.strong_total else 0.5,
        extraction_method="email",
    )


def read_email(
    message: Dict[str, Any],
    attachment: Optional[tuple[bytes, str]] = None,
    read_text=None,
    read_file=None,
) -> tuple[Optional[ReceiptExtraction], str]:
    """(extraction, why-not). Attachment first, then the AI on the text,
    with the plain-code reading as the safety net and the sanity check."""
    read_text = read_text or extraction_service.extract_receipt_text
    read_file = read_file or extraction_service.extract_receipt

    text = email_reader.email_text(message)
    code = email_reader.read(text, message.get("from") or "")

    if attachment is not None:
        data, mime = attachment
        try:
            got = read_file(data, mime)
            if not got.merchant or got.merchant == "Unknown":
                got.merchant = code.merchant
            return got, ""
        except extraction_service.ScanRejected:
            pass  # e.g. a logo or a terms PDF: fall back to the email itself
        except ai_usage.AILimitReached:
            pass  # the plain-code reading below still works without the AI
        except Exception:
            logger.exception("Reading an emailed attachment failed")

    try:
        got = read_text(text)
        # The store that sent the receipt beats whatever the AI picked up
        # from the forwarder's signature.
        if code.merchant and code.merchant != "Email receipt":
            got.merchant = code.merchant
            got.merchant_raw = got.merchant_raw or code.merchant
        if not got.date and code.when:
            got.date = code.when.isoformat()
        # A specific "Order total" printed in the email wins over the AI's sum.
        if (
            code.strong_total
            and code.total
            and abs((got.total or 0) - code.total) > 0.01
        ):
            got.total = code.total
        got.extraction_method = "email"
        return got, ""
    except extraction_service.ScanRejected as rejected:
        if code.strong_total and code.total:
            return _from_code(code), ""
        return None, (
            "This doesn't look like a receipt"
            if rejected.code == "not_a_receipt"
            else "Couldn't find a total in this email"
        )
    except ai_usage.AILimitReached as limit:
        if code.total:
            return _from_code(code), ""
        return None, f"{limit.message} Forward it again then."
    except Exception:
        logger.exception("Reading a forwarded email with the AI failed")
        if code.total:
            return _from_code(code), ""
        return None, "Couldn't read this email. Try forwarding it again later."


def _save(
    db: Session,
    user: User,
    extraction: ReceiptExtraction,
    stored: Optional[tuple[bytes, str, str]],
) -> tuple[Receipt, bool]:
    """Put the purchase on the tab, joining an earlier Apple Pay tap if there
    is one. Returns (receipt, joined_a_tap)."""
    when = None
    if extraction.date:
        try:
            when = datetime.fromisoformat(extraction.date).replace(
                hour=12, tzinfo=timezone.utc
            )
        except ValueError:
            when = None

    tap = capture_service.find_tap_match(
        db, user.id, extraction.merchant, extraction.total, when
    )
    receipt = tap or Receipt(user_id=user.id, source="email", image_key="")
    if tap is None:
        db.add(receipt)
        db.flush()
    tapped_at = tap.purchased_at if tap else None

    receipt.merchant = extraction.merchant or "Email receipt"
    receipt.merchant_raw = extraction.merchant_raw or receipt.merchant
    receipt.total = extraction.total or 0
    receipt.subtotal = extraction.subtotal or extraction.total or 0
    receipt.tax = extraction.tax or 0
    receipt.currency = (extraction.currency or "USD").upper()[:3]
    receipt.category = (
        extraction.category
        if extraction.category and extraction.category != "other"
        else capture_service.guess_category(db, user.id, receipt.merchant)
    )
    receipt.confidence = extraction.confidence or 0
    receipt.extraction_method = extraction.extraction_method or "email"
    receipt.status = "extracted"
    receipt.purchased_at = tapped_at or when or datetime.now(timezone.utc)

    db.query(ReceiptLineItem).filter(ReceiptLineItem.receipt_id == receipt.id).delete()
    for li in extraction.line_items:
        db.add(price_memory.make_line(receipt.id, user.id, li))

    if stored is not None:
        data, mime, name = stored
        key = s3_mod.generate_upload_path(user.id, name)
        try:
            s3_mod.upload_file(key, BytesIO(data), mime)
            receipt.image_key = key
        except Exception:
            logger.exception("Storing an emailed receipt file failed")

    sync_from_receipt(db, receipt)
    db.commit()
    db.refresh(receipt)
    return receipt, tap is not None


def process(inbound_id: str, db: Optional[Session] = None) -> None:
    """Process one queued email. Safe to call twice: only `queued` rows run."""
    own = db is None
    db = db or SessionLocal()
    try:
        row = db.get(InboundEmail, inbound_id)
        if row is None or row.status != "queued":
            return
        user = db.get(User, row.user_id) if row.user_id else None
        if user is None:
            return _finish(db, row, "ignored", "Unknown address")

        try:
            message = inbox_service.fetch_email(row.provider_id)
        except Exception:
            logger.exception("Fetching a forwarded email from Resend failed")
            return _finish(
                db, row, "failed", "Couldn't fetch this email. Forward it again."
            )

        if not _authenticated(message):
            return _finish(
                db,
                row,
                "ignored",
                "Your email provider couldn't confirm this came from you",
            )

        attachment = None
        stored = None
        if message.get("attachments"):
            try:
                metas = inbox_service.fetch_attachments(row.provider_id)
                pick = _pick_attachment(metas)
                if pick and pick.get("download_url"):
                    limit = get_settings().max_upload_bytes
                    data = inbox_service.download(pick["download_url"], limit)
                    if data:
                        mime = pick["content_type"].lower()
                        attachment = (data, mime)
                        stored = (data, mime, pick.get("filename") or "receipt")
            except Exception:
                logger.exception("Fetching an emailed attachment failed")

        with ai_usage.acting_for(user.id):
            extraction, why_not = read_email(message, attachment)
        if extraction is None:
            return _finish(db, row, "skipped", why_not)

        budgets_before = budget_service.evaluate_all(db, user.id)
        receipt, joined = _save(db, user, extraction, stored)
        budget_service.check_after_upload(db, user.id, budgets_before)
        _finish(
            db,
            row,
            "matched" if joined else "added",
            f"Joined your Apple Pay tap at {receipt.merchant}" if joined else "",
            receipt.id,
        )
    except Exception:
        logger.exception("Processing a forwarded email failed (inbound=%s)", inbound_id)
        db.rollback()
        row = db.get(InboundEmail, inbound_id)
        if row is not None and row.status == "queued":
            _finish(db, row, "failed", "Something went wrong reading this email.")
    finally:
        if own:
            db.close()
