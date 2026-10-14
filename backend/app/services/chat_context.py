"""A compact picture of someone's money, handed to the chat with every question.

Most questions ("how much did I spend this month?", "where do I spend the
most?", "am I on track?", "who owes me?") can be answered straight from this
summary in one AI call, with no lookups. That is what makes chat fast. The
tools are still there for anything the summary doesn't cover.

Everything here is computed from the database in a few cheap queries and kept
short: the summary rides along with every message, so every line costs tokens.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import Receipt, ReceiptLineItem, User
from app.services import budget_service, split_service
from app.services.analytics_service import COUNTED_STATUSES

RECENT_RECEIPTS = 12
TOP_MERCHANTS = 8


def _today(user: User, now: Optional[datetime] = None) -> date:
    now = now or datetime.now(timezone.utc)
    try:
        return now.astimezone(ZoneInfo(user.timezone or "UTC")).date()
    except Exception:
        return now.date()


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _prev_month_start(d: date) -> date:
    return (_month_start(d) - timedelta(days=1)).replace(day=1)


def _utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _money(amount: float, currency: str) -> str:
    symbol = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "CAD": "CA$", "AUD": "A$"}
    s = symbol.get(currency)
    return f"{s}{amount:,.2f}" if s else f"{amount:,.2f} {currency}"


def _totals(rows: Iterable[Receipt]) -> Dict[str, float]:
    out: Dict[str, float] = defaultdict(float)
    for r in rows:
        out[r.currency or "USD"] += float(r.total or 0)
    return out


def _fmt_totals(totals: Dict[str, float]) -> str:
    if not totals:
        return "nothing"
    return " + ".join(
        _money(v, c) for c, v in sorted(totals.items(), key=lambda x: -x[1])
    )


def _by(rows: Iterable[Receipt], key) -> List[Tuple[str, str, float, int]]:
    """[(name, currency, total, count)] sorted by total, per currency."""
    agg: Dict[Tuple[str, str], List[float]] = defaultdict(lambda: [0.0, 0])
    for r in rows:
        k = (key(r) or "other", r.currency or "USD")
        agg[k][0] += float(r.total or 0)
        agg[k][1] += 1
    return sorted(
        ((n, c, v[0], int(v[1])) for (n, c), v in agg.items()), key=lambda x: -x[2]
    )


def build(db: Session, user: User, now: Optional[datetime] = None) -> str:
    """The account summary, as short plain text for the system prompt."""
    today = _today(user, now)
    this_month = _month_start(today)
    last_month = _prev_month_start(today)
    since = _utc(today - timedelta(days=120))

    rows: List[Receipt] = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(COUNTED_STATUSES),
            Receipt.purchased_at >= since,
        )
        .order_by(Receipt.purchased_at.desc())
        .all()
    )
    all_count = (
        db.query(Receipt.id)
        .filter(Receipt.user_id == user.id, Receipt.deleted_at.is_(None))
        .count()
    )
    unread = (
        db.query(Receipt.id)
        .filter(
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
            Receipt.status == "failed",
        )
        .count()
    )

    def day(r: Receipt) -> date:
        return r.purchased_at.date() if r.purchased_at else today

    cur = [r for r in rows if day(r) >= this_month]
    prev = [r for r in rows if last_month <= day(r) < this_month]
    # Last month up to the same day, for a fair "am I spending more?" answer.
    same_day = this_month - last_month
    prev_to_date = [
        r for r in prev if day(r) <= min(today - same_day, this_month - timedelta(1))
    ]
    last_90 = [r for r in rows if day(r) >= today - timedelta(days=90)]

    lines: List[str] = []
    name = (user.full_name or "").split(" ")[0]
    lines.append(
        f"Name: {name or 'not given'}. Today: {today.isoformat()} ({today:%A})."
    )
    lines.append(
        f"Receipts on the tab: {all_count} in total"
        + (f", {unread} saved but not read yet" if unread else "")
        + "."
    )
    if not rows:
        lines.append("No purchases in the last 120 days.")
    currencies = Counter(r.currency or "USD" for r in rows)
    if len(currencies) > 1:
        lines.append(
            "Currencies used: "
            + ", ".join(c for c, _ in currencies.most_common())
            + ". Never add different currencies together."
        )

    lines.append("")
    lines.append(
        f"This month ({this_month:%B}, so far): {_fmt_totals(_totals(cur))}, {len(cur)} purchases."
    )
    lines.append(
        f"Last month ({last_month:%B}): {_fmt_totals(_totals(prev))}, {len(prev)} purchases;"
        f" by the same day of the month: {_fmt_totals(_totals(prev_to_date))}."
    )

    def cat_lines(title: str, group: List[Receipt]) -> None:
        cats = _by(group, lambda r: r.category)
        if cats:
            lines.append(
                f"{title} by category: "
                + "; ".join(f"{n} {_money(v, c)} ({k})" for n, c, v, k in cats[:10])
            )

    cat_lines("This month", cur)
    cat_lines("Last month", prev)

    merchants = _by(last_90, lambda r: r.merchant)
    if merchants:
        lines.append(
            "Top stores, last 90 days: "
            + "; ".join(
                f"{n} {_money(v, c)} over {k} visit{'s' if k != 1 else ''}"
                for n, c, v, k in merchants[:TOP_MERCHANTS]
            )
        )
    if last_90:
        weekday = _by(last_90, lambda r: day(r).strftime("%A"))
        lines.append(
            "Spending by weekday, last 90 days: "
            + "; ".join(f"{n} {_money(v, c)}" for n, c, v, _ in weekday[:7])
        )

    # Budgets
    states = budget_service.evaluate_all(db, user.id)
    lines.append("")
    if states:
        lines.append("Budgets (current period):")
        for s in states[:10]:
            flag = " OVER" if s["over_budget"] else ""
            lines.append(
                f"- {s['label']} ({s['period']}): spent {s['spent']:,.2f} of"
                f" {s['limit']:,.2f}, {s['percent_used']}% used,"
                f" {s['remaining']:,.2f} left, {s['period_start']} to {s['period_end']}{flag}"
            )
    else:
        lines.append("Budgets: none set yet.")

    # Splits
    try:
        balances = [
            b
            for b in split_service.owner_net_balances(db, user.id)
            if abs(b["net"]) >= 0.01
        ]
    except Exception:
        balances = []
    if balances:
        lines.append(
            "Unsettled splits: "
            + "; ".join(
                (
                    f"{b['person']} owes you {b['net']:,.2f}"
                    if b["net"] > 0
                    else f"you owe {b['person']} {-b['net']:,.2f}"
                )
                for b in balances[:10]
            )
        )
    else:
        lines.append("Unsettled splits: none.")

    # Recent receipts, with ids the tools need (never shown to the person).
    recent = rows[:RECENT_RECEIPTS]
    if recent:
        item_counts = Counter(
            rid
            for (rid,) in db.query(ReceiptLineItem.receipt_id)
            .filter(
                ReceiptLineItem.receipt_id.in_([r.id for r in recent]),
                ReceiptLineItem.deleted_at.is_(None),
            )
            .all()
        )
        lines.append("")
        lines.append("Most recent purchases (id is for tools only, never show it):")
        for r in recent:
            how = {"tap": ", Apple Pay", "email": ", from email"}.get(
                r.source or "", ""
            )
            lines.append(
                f"- {day(r).isoformat()} {r.merchant or 'Unknown'} {_money(float(r.total or 0), r.currency or 'USD')}"
                f" [{r.category or 'other'}{how}, {item_counts.get(r.id, 0)} items] id={r.id}"
            )
    return "\n".join(lines)
