"""Spending aggregations shared by the dashboard and the chat tools.

Both surfaces answer the same questions ("what did I spend this month", "which
category is biggest"), so the arithmetic lives here once. If the dashboard and
the assistant ever disagree about a number the user stops trusting both, and
duplicated query logic is how that happens.

Every function is user-scoped by required argument and filters soft-deleted rows.
Only `extracted` and `reviewed` receipts count toward money: an `uploaded` row
has no total yet and a `failed` one never will, so including them would quietly
understate spend.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Budget, Receipt

# Statuses whose totals are real money. Kept here so every caller agrees.
COUNTED_STATUSES = ("extracted", "reviewed")


def _utc_start(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)


def month_bounds(today: Optional[date] = None) -> Tuple[date, date]:
    """[first of this month, first of next month) — half-open to dodge the
    last-day-of-month off-by-one that `<= end` invites."""
    today = today or datetime.now(timezone.utc).date()
    first = today.replace(day=1)
    nxt = (
        first.replace(year=first.year + 1, month=1)
        if first.month == 12
        else first.replace(month=first.month + 1)
    )
    return first, nxt


def spend_query(
    db: Session,
    user_id: str,
    start: Optional[date] = None,
    end_exclusive: Optional[date] = None,
):
    """Base query for money-bearing receipts belonging to `user_id`."""
    q = db.query(Receipt).filter(
        Receipt.user_id == user_id,
        Receipt.deleted_at.is_(None),
        Receipt.status.in_(COUNTED_STATUSES),
    )
    if start is not None:
        q = q.filter(Receipt.purchased_at >= _utc_start(start))
    if end_exclusive is not None:
        q = q.filter(Receipt.purchased_at < _utc_start(end_exclusive))
    return q


def totals_for_period(
    db: Session, user_id: str, start: date, end_exclusive: date
) -> Dict[str, Any]:
    rows = spend_query(db, user_id, start, end_exclusive).all()
    total = sum(r.total or 0.0 for r in rows)
    return {
        "start_date": start.isoformat(),
        "end_date": (end_exclusive - timedelta(days=1)).isoformat(),
        "receipt_count": len(rows),
        "total_spent": round(total, 2),
        "currency": (rows[0].currency if rows else None) or "USD",
    }


def _top_group(
    db: Session, user_id: str, column, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    rows = (
        spend_query(db, user_id, start, end_exclusive)
        .with_entities(column, func.sum(Receipt.total), func.count(Receipt.id))
        .group_by(column)
        .all()
    )
    out = [
        {"name": name or "(unknown)", "amount": round(amount or 0.0, 2), "count": count}
        for name, amount, count in rows
    ]
    out.sort(key=lambda d: -d["amount"])
    return out


def category_breakdown(
    db: Session, user_id: str, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    return _top_group(db, user_id, Receipt.category, start, end_exclusive)


def merchant_breakdown(
    db: Session, user_id: str, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    return _top_group(db, user_id, Receipt.merchant, start, end_exclusive)


def monthly_trend(db: Session, user_id: str, months: int = 6) -> List[Dict[str, Any]]:
    """Spend per calendar month, oldest first, including months with no spend.

    Grouping is done in Python rather than SQL on purpose: SQLite and Postgres
    spell date truncation differently, and the row count here is tiny.
    """
    today = datetime.now(timezone.utc).date()
    first_of_now, _ = month_bounds(today)

    buckets: List[Tuple[date, date]] = []
    cursor = first_of_now
    for _ in range(months):
        nxt = (
            cursor.replace(year=cursor.year + 1, month=1)
            if cursor.month == 12
            else cursor.replace(month=cursor.month + 1)
        )
        buckets.append((cursor, nxt))
        cursor = (
            cursor.replace(year=cursor.year - 1, month=12)
            if cursor.month == 1
            else cursor.replace(month=cursor.month - 1)
        )
    buckets.reverse()

    window_start = buckets[0][0]
    rows = spend_query(db, user_id, window_start, buckets[-1][1]).all()

    out = []
    for start, end_exclusive in buckets:
        amount = sum(
            r.total or 0.0
            for r in rows
            if r.purchased_at and start <= r.purchased_at.date() < end_exclusive
        )
        out.append({"month": start.strftime("%Y-%m"), "amount": round(amount, 2)})
    return out


def budget_health(db: Session, user_id: str) -> List[Dict[str, Any]]:
    """Per-category budget usage for the current month, worst offender first."""
    budgets = (
        db.query(Budget)
        .filter(Budget.user_id == user_id, Budget.deleted_at.is_(None))
        .all()
    )
    if not budgets:
        return []
    start, end_exclusive = month_bounds()
    spent_by_cat = {
        row["name"]: row["amount"]
        for row in category_breakdown(db, user_id, start, end_exclusive)
    }
    out = []
    for b in budgets:
        limit = float(b.monthly_limit or 0.0)
        spent = float(spent_by_cat.get(b.category, 0.0))
        out.append(
            {
                "category": b.category,
                "limit": round(limit, 2),
                "spent": round(spent, 2),
                "percent_used": round((spent / limit * 100.0) if limit > 0 else 0.0, 1),
                "over_budget": spent > limit > 0,
            }
        )
    out.sort(key=lambda d: -d["percent_used"])
    return out


def pending_review_count(db: Session, user_id: str) -> int:
    """Receipts the extractor finished but a human hasn't confirmed."""
    return (
        db.query(func.count(Receipt.id))
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status == "extracted",
        )
        .scalar()
        or 0
    )


def dashboard_summary(
    db: Session, user_id: str, trend_months: int = 6
) -> Dict[str, Any]:
    """Everything the home page needs, in one round trip."""
    start, end_exclusive = month_bounds()
    categories = category_breakdown(db, user_id, start, end_exclusive)
    merchants = merchant_breakdown(db, user_id, start, end_exclusive)
    return {
        "this_month": totals_for_period(db, user_id, start, end_exclusive),
        "top_category": categories[0] if categories else None,
        "top_merchant": merchants[0] if merchants else None,
        "categories": categories,
        "merchants": merchants[:5],
        "monthly_trend": monthly_trend(db, user_id, trend_months),
        "budget_health": budget_health(db, user_id),
        "pending_review": pending_review_count(db, user_id),
    }
