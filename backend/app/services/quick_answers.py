"""Answer the most common spending questions straight from the database.

"How much did I spend on groceries this month?" doesn't need a language model:
it is one SUM over the user's receipts. Handling these here makes the answer
instant and free, and leaves the AI for questions that actually need it.

The matcher is deliberately strict. Anything it doesn't fully recognise (an
unknown word, a merchant, a reference to "this" receipt) returns None and the
question goes to the AI as before, so a quick answer is never a wrong guess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.services import budget_service, my_share
from app.services.analytics_service import month_bounds
from app.services.categories import CATEGORY_META

# Words people use for a category, mapped to its id. Mirrors the synonyms the
# AI rewrite step used to resolve ("coffee" -> dining, "supermarket" -> groceries).
_CATEGORY_WORDS: Dict[str, str] = {}
for _c in CATEGORY_META:
    _CATEGORY_WORDS[_c["id"]] = _c["id"]
    _CATEGORY_WORDS[_c["label"].lower()] = _c["id"]
_CATEGORY_WORDS.update(
    {
        "grocery": "groceries",
        "supermarket": "groceries",
        "food shopping": "groceries",
        "eating out": "dining",
        "restaurants": "dining",
        "restaurant": "dining",
        "takeout": "dining",
        "bars": "bars",
        "alcohol": "bars",
        "gas": "transport",
        "fuel": "transport",
        "uber": "transport",
        "shopping": "shopping",
        "clothes": "shopping",
        "bills": "utilities",
        "pharmacy": "health",
        "medicine": "health",
        "movies": "entertainment",
        "trips": "travel",
        "flights": "travel",
    }
)

_PERIODS = (
    "today",
    "yesterday",
    "this week",
    "last week",
    "this month",
    "last month",
    "this year",
)

_SPEND_RE = re.compile(
    r"^(?:so\s+)?(?:how much|what)\s+(?:did|have)\s+(?:i|we)\s+(?:spend|spent)"
    r"(?:\s+(?:on|for)\s+(?P<cat>[a-z ]+?))?"
    r"(?:\s+(?:in\s+)?(?P<period>" + "|".join(_PERIODS) + r"))?"
    r"(?:\s+(?:on|for)\s+(?P<cat2>[a-z ]+?))?"
    r"\s*\??$"
)
_TOTAL_RE = re.compile(
    r"^(?:what(?:'s| is)\s+)?(?:my\s+)?(?:total\s+)?(?:spending|spend|total spent)"
    r"(?:\s+(?:on|for)\s+(?P<cat>[a-z ]+?))?"
    r"(?:\s+(?P<period>" + "|".join(_PERIODS) + r"))?"
    r"\s*\??$"
)
_BUDGET_RE = re.compile(
    r"^(?:how(?:'s| is| are)\s+)?(?:my\s+)?budgets?"
    r"(?:\s+(?:status|doing|looking|left))?\s*\??$"
    r"|^how much (?:is |do i have )?left in my budgets?\s*\??$"
)


@dataclass
class QuickAnswer:
    text: str
    trace: List[Dict[str, Any]] = field(default_factory=list)


def _normalise(message: str) -> str:
    text = message.lower().strip()
    text = text.replace("’", "'")
    text = re.sub(r"\s+", " ", text)
    return text


def _period_bounds(period: Optional[str], today: date) -> Tuple[date, date, str]:
    """[start, end) and the words to use in the answer. Default: this month."""
    if period == "today":
        return today, today + timedelta(days=1), "today"
    if period == "yesterday":
        return today - timedelta(days=1), today, "yesterday"
    if period == "this week":
        monday = today - timedelta(days=today.weekday())
        return monday, today + timedelta(days=1), "this week"
    if period == "last week":
        monday = today - timedelta(days=today.weekday())
        return monday - timedelta(days=7), monday, "last week"
    if period == "last month":
        this_first, _ = month_bounds(today)
        prev_first, _ = month_bounds(this_first - timedelta(days=1))
        return prev_first, this_first, "last month"
    if period == "this year":
        return today.replace(month=1, day=1), today + timedelta(days=1), "this year"
    start, end = month_bounds(today)
    return start, end, "this month"


def _category(words: Optional[str]) -> Tuple[bool, Optional[str]]:
    """(understood, category id). Unknown words mean 'not understood'."""
    if not words:
        return True, None
    key = words.strip()
    if key in ("everything", "all", "stuff", "things", "total", "in total"):
        return True, None
    cat = _CATEGORY_WORDS.get(key)
    return (cat is not None), cat


def _money(amount: float, currency: str) -> str:
    symbol = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "CAD": "CA$", "AUD": "A$"}
    prefix = symbol.get(currency)
    return f"{prefix}{amount:,.2f}" if prefix else f"{currency} {amount:,.2f}"


def _spend_answer(
    db: Session, user_id: str, cat: Optional[str], period: Optional[str], today: date
) -> QuickAnswer:
    start, end, period_words = _period_bounds(period, today)
    spends = [
        s
        for s in my_share.spending(db, user_id, start, end)
        if not cat or s.receipt.category == cat
    ]
    total, count = sum(s.amount for s in spends), len(spends)
    currency = (spends[0].receipt.currency if spends else None) or "USD"
    label = next((c["label"] for c in CATEGORY_META if c["id"] == cat), None)
    what = f" on {label.lower()}" if label else ""
    if not count:
        text = f"Nothing{what} {period_words} yet. Nothing on your tab matches."
    else:
        purchases = f"{count} purchase{'s' if count != 1 else ''}"
        text = f"You spent {_money(total, currency)}{what} {period_words}, across {purchases}."
    return QuickAnswer(
        text,
        [
            {
                "tool": "quick_spend_total",
                "arguments": {"category": cat, "period": period_words},
                "result_summary": f"{count} receipts, total {round(total, 2)}",
                "data": {
                    "total": round(total, 2),
                    "count": count,
                    "currency": currency,
                    "start_date": start.isoformat(),
                    "end_date_exclusive": end.isoformat(),
                },
            }
        ],
    )


def _budget_answer(db: Session, user_id: str) -> QuickAnswer:
    states = budget_service.evaluate_all(db, user_id)
    if not states:
        return QuickAnswer(
            "You don't have any budgets yet. Set one on the Budgets page and Cotab "
            "will warn you before you go over.",
            [
                {
                    "tool": "quick_budget_status",
                    "arguments": {},
                    "result_summary": "0 budgets",
                    "data": {},
                }
            ],
        )
    lines = []
    for s in states:
        status = (
            "over"
            if s["over_budget"]
            else ("close" if s["percent_used"] >= 80 else "on track")
        )
        lines.append(
            f"{s['label'][:1].upper()}{s['label'][1:]}: "
            f"{_money(s['spent'], 'USD')} of {_money(s['limit'], 'USD')} ({status})"
        )
    over = [s for s in states if s["over_budget"]]
    lead = (
        f"{len(over)} of your budgets {'is' if len(over) == 1 else 'are'} over."
        if over
        else "All your budgets are within their limits."
    )
    return QuickAnswer(
        lead + "\n" + "\n".join(lines),
        [
            {
                "tool": "quick_budget_status",
                "arguments": {},
                "result_summary": f"{len(states)} budgets, {len(over)} over",
                "data": {"budgets": states},
            }
        ],
    )


def try_answer(
    db: Session,
    user_id: str,
    message: str,
    context: Optional[Dict[str, Any]] = None,
    today: Optional[date] = None,
) -> Optional[QuickAnswer]:
    """A complete answer for a recognised question, or None to use the AI."""
    # On a receipt or group page, "how much did I spend" may mean "on this".
    if context:
        return None
    text = _normalise(message)
    if len(text) > 120:
        return None
    today = today or datetime.now(timezone.utc).date()

    if _BUDGET_RE.match(text):
        return _budget_answer(db, user_id)

    m = _SPEND_RE.match(text) or _TOTAL_RE.match(text)
    if not m:
        return None
    groups = m.groupdict()
    cat_words = groups.get("cat") or groups.get("cat2")
    if groups.get("cat") and groups.get("cat2"):
        return None
    understood, cat = _category(cat_words)
    if not understood:
        return None
    return _spend_answer(db, user_id, cat, groups.get("period"), today)
