"""Filtering and search for the receipts list.

Search has to cover line-item descriptions, not just merchant names — "did I buy
paper towels" is the question people actually ask, and the answer lives in the
items. That means the text predicate spans two tables.

Dialect note: Postgres gets real full-text search (`to_tsvector @@ plainto_tsquery`,
backed by a GIN index from the migration); SQLite falls back to LIKE. Both are
exercised — production is Postgres, but every test and local dev run is SQLite,
so a Postgres-only implementation would mean the search path is never tested.
The fallback is a genuine substring match, not a stub.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Receipt, ReceiptLineItem

SORTABLE = {
    "date": Receipt.purchased_at,
    "amount": Receipt.total,
    "merchant": Receipt.merchant,
    "created": Receipt.created_at,
}


def _utc_start(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)


def _is_postgres(db: Session) -> bool:
    bind = db.get_bind()
    return bool(bind is not None and bind.dialect.name == "postgresql")


def _text_predicate(db: Session, q: str):
    """Match `q` against merchant name OR any of the receipt's line items."""
    term = q.strip()
    if _is_postgres(db):
        merchant_hit = func.to_tsvector(
            "english", func.coalesce(Receipt.merchant, "")
        ).op("@@")(func.plainto_tsquery("english", term))
        items = select(ReceiptLineItem.receipt_id).where(
            ReceiptLineItem.receipt_id == Receipt.id,
            func.to_tsvector(
                "english", func.coalesce(ReceiptLineItem.description, "")
            ).op("@@")(func.plainto_tsquery("english", term)),
        )
    else:
        like = f"%{term}%"
        merchant_hit = Receipt.merchant.ilike(like)
        items = select(ReceiptLineItem.receipt_id).where(
            ReceiptLineItem.receipt_id == Receipt.id,
            ReceiptLineItem.description.ilike(like),
        )
    return or_(merchant_hit, items.exists())


def build_query(
    db: Session,
    user_id: str,
    *,
    q: Optional[str] = None,
    category: Optional[str] = None,
    merchant: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    sort: str = "date",
    order: str = "desc",
):
    """All filters are combinable and AND-ed together.

    `end_date` is treated as inclusive — a user picking 31 Jan means "through the
    31st", so it is converted to an exclusive bound one day later rather than
    silently dropping that day's receipts.
    """
    query = db.query(Receipt).filter(
        Receipt.user_id == user_id, Receipt.deleted_at.is_(None)
    )

    if q and q.strip():
        query = query.filter(_text_predicate(db, q))
    if category:
        query = query.filter(Receipt.category == category.strip().lower())
    if merchant:
        query = query.filter(Receipt.merchant.ilike(f"%{merchant.strip()}%"))
    if status:
        query = query.filter(Receipt.status == status.strip().lower())
    if start_date:
        query = query.filter(Receipt.purchased_at >= _utc_start(start_date))
    if end_date:
        from datetime import timedelta

        query = query.filter(
            Receipt.purchased_at < _utc_start(end_date + timedelta(days=1))
        )
    if min_amount is not None:
        query = query.filter(Receipt.total >= min_amount)
    if max_amount is not None:
        query = query.filter(Receipt.total <= max_amount)

    col = SORTABLE.get(sort, Receipt.purchased_at)
    # nullslast: receipts whose date failed to extract sort to the bottom rather
    # than jumping to the top of a newest-first list.
    direction = col.desc().nullslast() if order == "desc" else col.asc().nullsfirst()
    return query.order_by(direction, Receipt.created_at.desc())


def search_receipts(
    db: Session, user_id: str, limit: int = 100, offset: int = 0, **filters: Any
) -> List[Receipt]:
    limit = max(1, min(int(limit), 500))
    return build_query(db, user_id, **filters).limit(limit).offset(max(0, offset)).all()


def filter_facets(db: Session, user_id: str) -> Dict[str, List[str]]:
    """Distinct values for populating filter dropdowns without a second guess."""
    base = db.query(Receipt).filter(
        Receipt.user_id == user_id, Receipt.deleted_at.is_(None)
    )
    cats = [c for (c,) in base.with_entities(Receipt.category).distinct() if c]
    merchants = [m for (m,) in base.with_entities(Receipt.merchant).distinct() if m]
    statuses = [s for (s,) in base.with_entities(Receipt.status).distinct() if s]
    return {
        "categories": sorted(cats),
        "merchants": sorted(merchants),
        "statuses": sorted(statuses),
    }
