"""Tabby speaking up on its own: gentle nudges about money friends still owe,
and the month wrap-up (a summary of last month, shareable).

These are plain facts from the database, written as insights so they show on
the home screen with the right Tabby pose. No AI is involved.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import (
    Budget,
    Receipt,
    ReceiptSplit,
    Settlement,
    TabbyActivity,
)
from app.services import budget_service, split_service

OWED_MIN = 5.0
OWED_DAYS = 14


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _weeks(days: int) -> str:
    if days < 21:
        return "two weeks"
    if days < 28:
        return "three weeks"
    months = days // 30
    if months <= 1:
        return "a month"
    return f"{months} months"


def owed(db: Session, user_id: str, now: Optional[datetime] = None) -> List[Dict]:
    """People who've owed this person at least $5 for two weeks or more."""
    now = now or datetime.now(timezone.utc)
    out = []
    for group in split_service.groups_for_user(db, user_id):
        me = next(
            (m for m in group.members if m.user_id == user_id and m.deleted_at is None),
            None,
        )
        if me is None:
            continue
        names = {m.id: m.name for m in group.members}
        for t in split_service.simplify_debts(db, group.id):
            if t["to"] != me.id or t["amount"] < OWED_MIN:
                continue
            last_paid = (
                db.query(Settlement)
                .filter(
                    Settlement.group_id == group.id,
                    Settlement.from_member_id == t["from"],
                    Settlement.deleted_at.is_(None),
                )
                .order_by(Settlement.created_at.desc())
                .first()
            )
            since = _aware(last_paid.created_at) if last_paid else None
            splits = (
                db.query(ReceiptSplit)
                .filter(
                    ReceiptSplit.group_id == group.id,
                    ReceiptSplit.deleted_at.is_(None),
                )
                .all()
            )
            dates = [
                _aware(s.created_at)
                for s in splits
                if s.created_at and (since is None or _aware(s.created_at) > since)
            ]
            if not dates:
                continue
            days = (now - min(dates)).days
            if days < OWED_DAYS:
                continue
            out.append(
                {
                    "person": names.get(t["from"], "Someone"),
                    "amount": round(t["amount"], 2),
                    "days": days,
                    "group_id": group.id,
                    "tab": group.name,
                }
            )
    return sorted(out, key=lambda r: -r["amount"])


def _month_bounds(month: str) -> tuple:
    start = date.fromisoformat(f"{month}-01")
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    to_dt = lambda d: datetime(d.year, d.month, d.day, tzinfo=timezone.utc)  # noqa
    return start, end, to_dt(start), to_dt(end)


def wrap(db: Session, user_id: str, month: str) -> Dict[str, Any]:
    """Last month in a few lines: what was spent, where, what changed, how the
    budgets went, the splits, and what Tabby did."""
    start, end, start_at, end_at = _month_bounds(month)
    receipts = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.purchased_at >= start_at,
            Receipt.purchased_at < end_at,
        )
        .all()
    )
    currency = (
        Counter(r.currency or "USD" for r in receipts).most_common(1)[0][0]
        if receipts
        else "USD"
    )
    mine = [r for r in receipts if (r.currency or "USD") == currency]
    total = round(sum(r.total or 0 for r in mine), 2)
    by_category: Counter = Counter()
    by_store: Counter = Counter()
    for r in mine:
        by_category[r.category or "other"] += r.total or 0
        by_store[(r.merchant or "Receipt").strip()] += 1

    prev_start, _, prev_start_at, prev_end_at = _month_bounds(
        (start - timedelta(days=1)).strftime("%Y-%m")
    )
    previous = sum(
        r.total or 0
        for r in db.query(Receipt).filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.currency == currency,
            Receipt.purchased_at >= prev_start_at,
            Receipt.purchased_at < prev_end_at,
        )
    )

    kept, budgets = 0, 0
    for budget in (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id,
            Budget.deleted_at.is_(None),
            Budget.period == "monthly",
        )
        .all()
    ):
        budgets += 1
        if budget_service.spent_for(db, user_id, budget, start, end) <= budget.amount:
            kept += 1

    group_ids = [g.id for g in split_service.groups_for_user(db, user_id)]
    splits = (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.group_id.in_(group_ids or [""]),
            ReceiptSplit.deleted_at.is_(None),
            ReceiptSplit.created_at >= start_at,
            ReceiptSplit.created_at < end_at,
        )
        .count()
    )
    settled = round(
        sum(
            p.amount
            for p in db.query(Settlement).filter(
                Settlement.group_id.in_(group_ids or [""]),
                Settlement.deleted_at.is_(None),
                Settlement.created_at >= start_at,
                Settlement.created_at < end_at,
            )
        ),
        2,
    )
    tabby_runs = len(
        {
            row.run_id
            for row in db.query(TabbyActivity.run_id).filter(
                TabbyActivity.user_id == user_id,
                TabbyActivity.status == "done",
                TabbyActivity.created_at >= start_at,
                TabbyActivity.created_at < end_at,
            )
        }
    )
    top_category = by_category.most_common(1)
    top_store = by_store.most_common(1)
    return {
        "month": month,
        "label": f"{start:%B %Y}",
        "currency": currency,
        "total": total,
        "receipts": len(mine),
        "previous": round(previous, 2),
        "change": round(total - previous, 2) if previous else None,
        "top_category": (
            {"name": top_category[0][0], "amount": round(top_category[0][1], 2)}
            if top_category
            else None
        ),
        "top_store": (
            {"name": top_store[0][0], "visits": top_store[0][1]} if top_store else None
        ),
        "categories": [
            {"name": k, "amount": round(v, 2)} for k, v in by_category.most_common(5)
        ],
        "budgets": budgets,
        "budgets_kept": kept,
        "splits": splits,
        "settled": settled,
        "tabby_tasks": tabby_runs,
    }


def add_insights(db: Session, user_id: str, save: Callable, now=None) -> List[Any]:
    """Write today's nudges as insights (the caller commits)."""
    now = now or datetime.now(timezone.utc)
    saved = []
    for row in owed(db, user_id, now)[:2]:
        saved.append(
            save(
                db,
                user_id,
                "owed",
                f"owed:{row['group_id']}:{row['person'].lower()}:{now:%G-%V}",
                f"{row['person']} has owed you ${row['amount']:,.2f} for "
                f"{_weeks(row['days'])}",
                f"On {row['tab']}. Tabby can send {row['person']} a friendly "
                "reminder with your payment link.",
                {
                    **row,
                    "ask": f"Remind {row['person']} about the ${row['amount']:,.2f} "
                    f"they owe me on {row['tab']}",
                },
            )
        )
    if now.day <= 7:
        last = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        summary = wrap(db, user_id, last)
        if summary["receipts"] >= 3:
            saved.append(
                save(
                    db,
                    user_id,
                    "month_wrap",
                    f"wrap:{last}",
                    f"Your {summary['label'].split()[0]} wrap-up is ready",
                    f"${summary['total']:,.2f} across {summary['receipts']} receipts"
                    + (
                        f", mostly {summary['top_category']['name']}."
                        if summary["top_category"]
                        else "."
                    ),
                    {"month": last, "open": f"/app/tabby/wrap?month={last}"},
                )
            )
    return saved
