"""Reading a scanned receipt, in the background.

Upload saves the file and a `processing` receipt and answers at once; the
reading happens here, on a small pool of worker threads, so a batch of photos
uploads in seconds and keeps being read even if the phone goes to sleep. The
app polls `GET /receipts/{id}/scan` for the outcome.

Outcomes, written to the receipt:

- read: `extracted`, with items, category, and any budget alerts or possible
  duplicate noted in `scan_info`;
- joined an Apple Pay tap: the tap gets the items and the photo, and this
  receipt is soft-deleted with `scan_info.merged_into` pointing at the tap;
- not a receipt or unreadable: soft-deleted with `scan_info.rejected` and the
  reason, and the file removed, so nothing lands on the tab;
- the AI failed or today's budget is spent: `failed`, kept for "Read it again".

Work lost to a restart is picked up again: anything still `processing` after
STUCK_AFTER is re-read from the stored file (on startup, and when polled).
"""

from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.db import s3 as s3_mod
from app.models import Receipt
from app.services import (
    ai_usage,
    budget_service,
    capture_service,
    extraction_service,
    notify,
    split_service,
    tabby_rules,
)
from app.services.purchase_service import sync_from_receipt
from app.services.reminder_service import check_budget_alerts

logger = logging.getLogger(__name__)

EXTRACTION_FAILED_MESSAGE = (
    "We couldn't read this receipt. Try retrying, or enter the details by hand."
)
PDF_TYPE = "application/pdf"
# A read takes seconds; one still "processing" after this was lost (restart).
STUCK_AFTER = timedelta(minutes=2)
WORKERS = 4

# Where the worker gets its own database session. Tests point this at theirs.
session_factory: Optional[Callable[[], Session]] = None


def _new_session() -> Session:
    if session_factory is not None:
        return session_factory()
    from app.db.session import SessionLocal

    return SessionLocal()


_pool: Optional[ThreadPoolExecutor] = None
_pool_lock = threading.Lock()


def _executor() -> ThreadPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="scan")
        return _pool


# --- helpers shared with the receipts API ------------------------------------------


def mime_for_key(key: str) -> str:
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


def printed_date(value: Optional[str]) -> Optional[datetime]:
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


def apply_extraction(db: Session, receipt: Receipt, user_id: str, extraction) -> list:
    """Write an extraction onto a receipt row: replace fields + line items.
    Caller commits, then tells friends whose shares changed (the return)."""
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
        try:
            receipt.purchased_at = datetime.fromisoformat(extraction.date)
        except ValueError:
            pass
    return split_service.replace_lines(db, receipt, user_id, extraction.line_items)


def near_duplicate(db: Session, receipt: Receipt) -> Optional[str]:
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


def info(receipt: Receipt) -> Dict[str, Any]:
    try:
        return json.loads(receipt.scan_info or "{}")
    except ValueError:
        return {}


def _set_info(receipt: Receipt, **values: Any) -> None:
    receipt.scan_info = json.dumps(values, default=str)


# --- reading ---------------------------------------------------------------------


@dataclass
class Outcome:
    """What became of a scan, for the API to report."""

    receipt: Receipt
    rejected_code: Optional[str] = None
    rejected_message: str = ""
    matched_tap: bool = False
    possible_duplicate_of: Optional[str] = None
    budget_alerts: List[dict] = field(default_factory=list)


def read(
    db: Session,
    receipt_id: str,
    data: Optional[bytes] = None,
    mime: Optional[str] = None,
    keep_if_refused: bool = False,
) -> Optional[Outcome]:
    """Read one `processing` receipt and record the outcome. Returns None if
    it was already done (another worker got there first).

    `keep_if_refused` is for reading again a receipt that was already on the
    tab: a refusal then marks it failed with the reason instead of removing it.
    """
    receipt = db.get(Receipt, receipt_id)
    if receipt is None or receipt.status != "processing" or receipt.deleted_at:
        return None
    user_id = receipt.user_id
    mime = mime or mime_for_key(receipt.image_key or "")

    extraction = None
    failed_message = EXTRACTION_FAILED_MESSAGE
    try:
        if data is None:
            data = s3_mod.download_bytes(receipt.image_key)
        with ai_usage.acting_for(user_id):
            extraction = extraction_service.extract_receipt(data, mime)
    except extraction_service.ScanRejected as rejected:
        logger.info("Scan rejected (user=%s, code=%s)", user_id, rejected.code)
        if keep_if_refused:
            receipt.status = "failed"
            receipt.error_message = rejected.message
            db.commit()
            return Outcome(receipt, rejected.code, rejected.message)
        receipt.status = "rejected"
        receipt.error_message = rejected.message
        receipt.deleted_at = datetime.now(timezone.utc)
        _set_info(receipt, rejected=rejected.code)
        db.commit()
        if receipt.image_key:
            s3_mod.delete_file(receipt.image_key)
        return Outcome(receipt, rejected.code, rejected.message)
    except ai_usage.AILimitReached as limit:
        failed_message = (
            f"{limit.message} Your photo is saved: open it then and tap Read it again."
        )
    except Exception:
        logger.exception("Receipt extraction failed (receipt=%s)", receipt_id)

    if extraction is None:
        receipt.status = "failed"
        receipt.error_message = failed_message
        sync_from_receipt(db, receipt)
        db.commit()
        return Outcome(receipt)

    budgets_before = budget_service.evaluate_all(db, user_id)
    tap = capture_service.find_tap_match(
        db,
        user_id,
        extraction.merchant or extraction.merchant_raw,
        extraction.total,
        printed_date(extraction.date),
    )
    target = tap or receipt
    tapped_at = tap.purchased_at if tap else None
    resplit = apply_extraction(db, target, user_id, extraction)
    target.status = "extracted"
    target.error_message = ""
    if tap is not None:
        # The tap knows the exact time; the receipt usually only the day.
        if target.purchased_at is None or (
            tapped_at and target.purchased_at.date() == tapped_at.date()
        ):
            target.purchased_at = tapped_at
        tap.image_key = receipt.image_key
        tap.image_sha256 = receipt.image_sha256
        receipt.status = "merged"
        receipt.deleted_at = datetime.now(timezone.utc)
        receipt.image_sha256 = None
        _set_info(receipt, merged_into=tap.id)
    sync_from_receipt(db, target)
    db.commit()
    notify.splits_changed(db, target, user_id, resplit)

    check_budget_alerts(db, user_id)
    tabby_rules.on_new_receipt(db, user_id, target)
    crossed = budget_service.check_after_upload(db, user_id, budgets_before)
    duplicate_of = None if tap else near_duplicate(db, target)
    _set_info(
        target,
        matched_tap=tap is not None,
        possible_duplicate_of=duplicate_of,
        budget_alerts=crossed,
    )
    db.commit()
    db.refresh(target)
    return Outcome(
        target,
        matched_tap=tap is not None,
        possible_duplicate_of=duplicate_of,
        budget_alerts=crossed,
    )


def _read_in_own_session(
    receipt_id: str, data: Optional[bytes], mime: Optional[str]
) -> None:
    db = _new_session()
    try:
        read(db, receipt_id, data, mime)
    except Exception:
        logger.exception("Background scan failed (receipt=%s)", receipt_id)
        db.rollback()
        receipt = db.get(Receipt, receipt_id)
        if receipt is not None and receipt.status == "processing":
            receipt.status = "failed"
            receipt.error_message = EXTRACTION_FAILED_MESSAGE
            db.commit()
    finally:
        db.close()


def submit(receipt_id: str, data: Optional[bytes] = None, mime: Optional[str] = None):
    """Read this receipt on a worker thread."""
    _executor().submit(_read_in_own_session, receipt_id, data, mime)


def claim_if_stuck(db: Session, receipt: Receipt) -> bool:
    """Take over a scan that was lost (still `processing` long after it
    started). Atomic, so two pollers can't both restart it."""
    if receipt.status != "processing" or receipt.deleted_at:
        return False
    started = receipt.reading_since or receipt.created_at
    if started and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if started and now - started < STUCK_AFTER:
        return False
    cutoff = now - STUCK_AFTER
    claimed = (
        db.query(Receipt)
        .filter(
            Receipt.id == receipt.id,
            Receipt.status == "processing",
            (Receipt.reading_since.is_(None)) | (Receipt.reading_since < cutoff),
        )
        .update({Receipt.reading_since: now}, synchronize_session=False)
    )
    db.commit()
    return bool(claimed)


def resume_stuck(limit: int = 50) -> int:
    """Re-read scans lost to a restart. Called on startup."""
    db = _new_session()
    try:
        cutoff = datetime.now(timezone.utc) - STUCK_AFTER
        rows = (
            db.query(Receipt)
            .filter(
                Receipt.status == "processing",
                Receipt.deleted_at.is_(None),
                Receipt.image_key != "",
                (Receipt.reading_since.is_(None)) | (Receipt.reading_since < cutoff),
            )
            .limit(limit)
            .all()
        )
        resumed = 0
        for r in rows:
            if claim_if_stuck(db, r):
                submit(r.id)
                resumed += 1
        if resumed:
            logger.warning("Resumed %d scans left unread by a restart", resumed)
        return resumed
    except Exception:
        logger.exception("Couldn't resume unread scans")
        return 0
    finally:
        db.close()


def in_background() -> bool:
    return get_settings().scan_in_background
