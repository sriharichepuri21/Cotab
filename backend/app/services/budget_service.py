"""Budget evaluation.

A budget is (level, target, period, amount). Evaluating one means: work out the
current period's window, sum the spend that matches the level/target inside it,
and compare.

Two decisions shape everything below:

0. **Spend is your share.** A split purchase counts what it cost you, and a
   friend's receipt split with you counts your share (my_share).

1. **Item budgets are measured on line items, not receipts.** A $50 coffee
   budget must count the $4 latte on a $90 grocery receipt, not the whole $90.
   Every other level sums receipt totals; `item` sums matching line-item
   `total_price`. Mixing those up is the difference between a useful budget and
   a nonsense one.

2. **Thresholds fire on crossing, not on being over.** `evaluate` reports the
   highest threshold reached; the caller compares against the state *before* the
   receipt to decide whether to alert. Without that, every upload after the first
   overage re-alerts and the user learns to ignore them.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import Budget
from app.services import my_share

LEVELS = ("total", "category", "merchant", "item")
PERIODS = ("weekly", "monthly", "yearly")
DEFAULT_THRESHOLDS = (80, 100, 120)

# What receipts call these items: a "coffee" budget has to count the
# "Caffe Latte" line, which never says coffee. Whole words only ("tea" is in
# "steak").
ITEM_WORDS = {
    "coffee": (
        "latte",
        "espresso",
        "americano",
        "cappuccino",
        "macchiato",
        "mocha",
        "cold brew",
        "flat white",
        "cortado",
        "frappuccino",
    ),
    "tea": ("chai", "matcha", "milk tea", "boba"),
    "boba": ("bubble tea", "milk tea"),
}


def item_matcher(target: str):
    """Whether a line item's text counts toward an item budget for `target`."""
    if target not in ITEM_WORDS:
        return lambda text: target in text.lower()
    words = (target, *ITEM_WORDS[target])
    pattern = re.compile(r"\b(" + "|".join(map(re.escape, words)) + r")\b")
    return lambda text: bool(pattern.search(text.lower()))


def period_bounds(period: str, today: Optional[date] = None) -> Tuple[date, date]:
    """Half-open [start, end) window for the *current* period.

    Weeks start Monday. Half-open throughout so the last day of a period is
    included without the `<= end` off-by-one.
    """
    today = today or datetime.now(timezone.utc).date()
    if period == "weekly":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=7)
    if period == "yearly":
        return date(today.year, 1, 1), date(today.year + 1, 1, 1)
    # monthly (default)
    start = today.replace(day=1)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return start, end


def parse_thresholds(raw: Optional[str]) -> List[int]:
    """ "80,100,120" -> [80, 100, 120], ascending, bad entries ignored."""
    out: List[int] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            v = int(part)
            if 0 < v <= 1000:
                out.append(v)
    return sorted(set(out)) or list(DEFAULT_THRESHOLDS)


def spent_for(
    db: Session, user_id: str, budget: Budget, start: date, end: date
) -> float:
    """Spend matching this budget's level/target within [start, end)."""
    level = (budget.level or "category").lower()
    target = (budget.target or "").strip().lower()
    spends = my_share.spending(db, user_id, start, end)

    if level == "item":
        # Sum the matching LINE ITEMS, not their parent receipts — see module docstring.
        return my_share.item_spend(db, spends, item_matcher(target))
    if level == "category":
        spends = [s for s in spends if s.receipt.category == target]
    elif level == "merchant":
        spends = [s for s in spends if target in (s.receipt.merchant or "").lower()]
    # level == "total": no extra filter, the whole period counts
    return round(sum(s.amount for s in spends), 2)


def _label(budget: Budget) -> str:
    """Human name only — the level travels as its own field.

    Baking it in ("groceries (category)") reads badly and forces every consumer
    to accept our phrasing; the UI renders `level` as a badge instead.
    """
    level = (budget.level or "category").lower()
    if level == "total":
        return f"{(budget.period or 'monthly').capitalize()} total"
    return budget.target or "(unnamed)"


def evaluate(db: Session, user_id: str, budget: Budget) -> Dict[str, Any]:
    start, end = period_bounds(budget.period or "monthly")
    spent = spent_for(db, user_id, budget, start, end)
    limit = float(budget.amount or 0.0)
    pct = round((spent / limit * 100.0), 1) if limit > 0 else 0.0
    thresholds = parse_thresholds(budget.alert_thresholds)
    reached = [t for t in thresholds if pct >= t]
    return {
        "budget_id": budget.id,
        "label": _label(budget),
        "level": budget.level,
        "target": budget.target,
        "period": budget.period,
        "limit": round(limit, 2),
        "spent": spent,
        "remaining": round(limit - spent, 2),
        "percent_used": pct,
        "over_budget": limit > 0 and spent > limit,
        "period_start": start.isoformat(),
        "period_end": (end - timedelta(days=1)).isoformat(),
        "thresholds": thresholds,
        "threshold_reached": reached[-1] if reached else None,
    }


def active_budgets(db: Session, user_id: str) -> List[Budget]:
    return (
        db.query(Budget)
        .filter(Budget.user_id == user_id, Budget.deleted_at.is_(None))
        .order_by(Budget.created_at.asc())
        .all()
    )


def evaluate_all(db: Session, user_id: str) -> List[Dict[str, Any]]:
    """Every budget's current state, worst offender first."""
    states = [evaluate(db, user_id, b) for b in active_budgets(db, user_id)]
    states.sort(key=lambda s: -s["percent_used"])
    return states


def alerts_from(states: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The subset currently at or past their first threshold."""
    return [s for s in states if s["threshold_reached"] is not None]


def check_after_upload(
    db: Session, user_id: str, before: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Budgets whose threshold level rose because of the receipt just added.

    `before` is the output of evaluate_all() taken *before* the receipt was
    applied. Only newly-crossed thresholds are returned, so uploading a fifth
    receipt into an already-blown budget stays quiet instead of re-alerting.
    """
    prior = {s["budget_id"]: s["threshold_reached"] or 0 for s in before}
    crossed = []
    for state in evaluate_all(db, user_id):
        was = prior.get(state["budget_id"], 0)
        now = state["threshold_reached"] or 0
        if now > was:
            crossed.append(state)
    return crossed
