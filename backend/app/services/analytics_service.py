"""Spending aggregations shared by the dashboard and the chat tools.

Both surfaces answer the same questions ("what did I spend this month", "which
category is biggest"), so the arithmetic lives here once. If the dashboard and
the assistant ever disagree about a number the user stops trusting both, and
duplicated query logic is how that happens.

Every function is user-scoped by required argument and filters soft-deleted rows.
Money is what each purchase cost *you*: your share when it's split on a tab,
including friends' receipts split with you (my_share.spending).
Only `extracted` and `reviewed` receipts count toward money: an `uploaded` row
has no total yet and a `failed` one never will, so including them would quietly
understate spend.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Receipt
from app.services.my_share import spending

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
    spends = spending(db, user_id, start, end_exclusive)
    return {
        "start_date": start.isoformat(),
        "end_date": (end_exclusive - timedelta(days=1)).isoformat(),
        "receipt_count": len(spends),
        "total_spent": round(sum(s.amount for s in spends), 2),
        "currency": (spends[0].receipt.currency if spends else None) or "USD",
    }


def _top_group(
    db: Session, user_id: str, field: str, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    groups: Dict[Any, List[float]] = {}
    for spend in spending(db, user_id, start, end_exclusive):
        groups.setdefault(getattr(spend.receipt, field), []).append(spend.amount)
    out = [
        {
            "name": name or "(unknown)",
            "amount": round(sum(amounts), 2),
            "count": len(amounts),
        }
        for name, amounts in groups.items()
    ]
    out.sort(key=lambda d: -d["amount"])
    return out


def category_breakdown(
    db: Session, user_id: str, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    return _top_group(db, user_id, "category", start, end_exclusive)


def merchant_breakdown(
    db: Session, user_id: str, start: date, end_exclusive: date
) -> List[Dict[str, Any]]:
    return _top_group(db, user_id, "merchant", start, end_exclusive)


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
    spends = spending(db, user_id, window_start, buckets[-1][1])

    out = []
    for start, end_exclusive in buckets:
        amount = sum(
            s.amount
            for s in spends
            if s.receipt.purchased_at
            and start <= s.receipt.purchased_at.date() < end_exclusive
        )
        out.append({"month": start.strftime("%Y-%m"), "amount": round(amount, 2)})
    return out


def budget_health(
    db: Session, user_id: str, states: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """Per-budget usage for the dashboard, worst offender first.

    Delegates to budget_service so the dashboard card, the /budgets page and the
    post-upload check all read the same evaluation — a budget that says 92% in
    one place and 78% in another is worse than no budget at all.
    """
    from app.services import budget_service

    return [
        {
            # The name to show ("Monthly total", "Paneer"); `level` and
            # `period` say what kind of budget it is.
            "category": s["label"],
            "level": s["level"],
            "period": s["period"],
            "limit": s["limit"],
            "spent": s["spent"],
            "percent_used": s["percent_used"],
            "over_budget": s["over_budget"],
        }
        for s in (
            states if states is not None else budget_service.evaluate_all(db, user_id)
        )
    ]


def budget_alerts(
    db: Session, user_id: str, states: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """Budgets currently at or past their first alert threshold.

    Distinct from budget_health, which lists every budget: this is only the ones
    worth interrupting someone about, so the dashboard card can show a count
    without the reader having to scan the bars themselves.
    """
    from app.services import budget_service

    return budget_service.alerts_from(
        states if states is not None else budget_service.evaluate_all(db, user_id)
    )


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
    from app.services import budget_service

    categories = category_breakdown(db, user_id, start, end_exclusive)
    merchants = merchant_breakdown(db, user_id, start, end_exclusive)
    # Evaluate budgets once and feed both cards; this used to run twice.
    states = budget_service.evaluate_all(db, user_id)
    return {
        "this_month": totals_for_period(db, user_id, start, end_exclusive),
        "top_category": categories[0] if categories else None,
        "top_merchant": merchants[0] if merchants else None,
        "categories": categories,
        "merchants": merchants[:5],
        "monthly_trend": monthly_trend(db, user_id, trend_months),
        "budget_health": budget_health(db, user_id, states),
        "budget_alerts": budget_alerts(db, user_id, states),
        "pending_review": pending_review_count(db, user_id),
    }
