"""What the AI costs, and the daily caps that keep it affordable.

Every call to Gemini goes through `guarded()`: it checks the caps first,
makes the call, then records the tokens used and an estimated cost in
`ai_usage`. Two caps apply, both per UTC day:

- per person (`ai_user_daily_budget_usd`), so one heavy user or a forwarding
  loop can't use up everyone's share;
- for the whole app (`ai_daily_budget_usd`), so a bug or abuse can't run up
  a bill.

Costs are estimated at paid-tier list prices. While the app runs on Gemini's
free tier the real bill is $0, so the caps are a ceiling, not an invoice.

Who a call is for is carried in a context variable (`acting_for`), set where
the request starts (upload, email processing, chat), so the code that talks to
Gemini doesn't need a user id threaded through every function.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any, Callable, Iterator, Optional, TypeVar

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config.settings import get_settings

logger = logging.getLogger(__name__)

# US dollars per 1M tokens: (input, output). Output includes the model's
# thinking. From ai.google.dev/gemini-api/docs/pricing (Standard tier).
# Flash prices are the higher ones Google has announced for 2027, so the caps
# don't quietly loosen when prices rise.
PRICES: dict[str, tuple[float, float]] = {
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3.5-flash": (1.50, 7.50),  # routed to 3.6 Flash
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.8-flash": (1.50, 7.50),
}
# A model we don't know is priced like the dearest Flash, to stay cautious.
UNKNOWN_PRICE = (1.50, 7.50)

FEATURES = ("scan", "email", "chat", "rewrite")

_acting_for: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "ai_acting_for", default=None
)

T = TypeVar("T")


class AILimitReached(Exception):
    """Today's AI budget is used up, for this person or for everyone."""

    def __init__(self, scope: str):
        self.scope = scope  # "user" | "app"
        self.message = (
            "You've reached today's limit for AI reading. It resets tomorrow."
            if scope == "user"
            else "Cotab has paused AI reading for today. It resets tomorrow."
        )
        super().__init__(self.message)


@contextlib.contextmanager
def acting_for(user_id: Optional[str]) -> Iterator[None]:
    """Attribute AI calls made inside this block to `user_id`."""
    token = _acting_for.set(user_id)
    try:
        yield
    finally:
        _acting_for.reset(token)


def current_user() -> Optional[str]:
    return _acting_for.get()


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES.get(model, UNKNOWN_PRICE)
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


def tokens_from(response: Any) -> tuple[int, int]:
    """(input, output) tokens from a Gemini response. Output is everything
    after the prompt, so it includes thinking even where the SDK has no
    separate field for it."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return 0, 0
    prompt = int(getattr(usage, "prompt_token_count", 0) or 0)
    total = int(getattr(usage, "total_token_count", 0) or 0)
    output = int(getattr(usage, "candidates_token_count", 0) or 0)
    return prompt, max(output, total - prompt)


def _day_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return datetime.combine(now.date(), time.min, tzinfo=timezone.utc)


def spent_today(
    db: Session, user_id: Optional[str] = None, now: Optional[datetime] = None
) -> float:
    from app.models import AIUsage

    q = db.query(func.coalesce(func.sum(AIUsage.cost_usd), 0.0)).filter(
        AIUsage.created_at >= _day_start(now)
    )
    if user_id is not None:
        q = q.filter(AIUsage.user_id == user_id)
    return float(q.scalar() or 0.0)


# Where usage is read and written when no session is passed in. None means the
# app database; tests point it at their own database, or set it to False to
# leave usage out entirely.
_factory: Any = None


@contextlib.contextmanager
def _session(db: Optional[Session]) -> Iterator[Optional[Session]]:
    if db is not None:
        yield db
        return
    if _factory is False:
        yield None
        return
    if _factory is None:
        from app.db.session import SessionLocal

        own = SessionLocal()
    else:
        own = _factory()
    try:
        yield own
    finally:
        own.close()


def check(user_id: Optional[str] = None, db: Optional[Session] = None) -> None:
    """Raise AILimitReached if today's budget is used up.

    If the usage table can't be read the call is allowed: a database hiccup
    shouldn't stop scanning, and the per-hour rate limits still apply.
    """
    settings = get_settings()
    user_id = user_id if user_id is not None else current_user()
    try:
        with _session(db) as s:
            if s is None:
                return
            app_spent = spent_today(s)
            if app_spent >= settings.ai_daily_budget_usd:
                logger.warning("AI daily budget reached for the whole app")
                _alert_spend(app_spent, settings.ai_daily_budget_usd, reached=True)
                raise AILimitReached("app")
            if (
                app_spent
                >= settings.ai_daily_budget_usd * settings.ai_budget_alert_ratio
            ):
                _alert_spend(app_spent, settings.ai_daily_budget_usd, reached=False)
            if user_id and spent_today(s, user_id) >= settings.ai_user_daily_budget_usd:
                logger.info("AI daily budget reached (user=%s)", user_id)
                raise AILimitReached("user")
    except AILimitReached:
        raise
    except Exception:
        logger.exception("Couldn't check the AI budget; allowing the call")


def _alert_spend(spent: float, budget: float, reached: bool) -> None:
    """Tell the operator, once a day each, when spend nears and hits the cap."""
    from app.services import ops_alerts

    day = _day_start().date().isoformat()
    if reached:
        ops_alerts.alert(
            "ai_budget_reached",
            f"AI spend today is ${spent:.2f}, the whole daily budget (${budget:.2f}). "
            "Scans and Tabby are paused for everyone until midnight UTC.",
            key=day,
        )
    else:
        ops_alerts.alert(
            "ai_budget_near",
            f"AI spend today is ${spent:.2f} of the ${budget:.2f} daily budget.",
            key=day,
        )


def record(
    feature: str,
    model: str,
    response: Any,
    user_id: Optional[str] = None,
    db: Optional[Session] = None,
) -> None:
    """Log one call. Never raises: a failed log must not fail the scan."""
    from app.models import AIUsage

    input_tokens, output_tokens = tokens_from(response)
    user_id = user_id if user_id is not None else current_user()
    try:
        with _session(db) as s:
            if s is None:
                return
            s.add(
                AIUsage(
                    user_id=user_id,
                    feature=feature,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=estimate_cost(model, input_tokens, output_tokens),
                )
            )
            s.commit()
    except Exception:
        logger.exception("Couldn't record AI usage (feature=%s)", feature)


def guarded(feature: str, model: str, call: Callable[[], T]) -> T:
    """Check the caps, make the call, record what it used."""
    check()
    response = call()
    record(feature, model, response)
    return response


@dataclass
class UsageSummary:
    since: datetime
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    by_feature: dict[str, dict[str, float]]
    by_model: dict[str, dict[str, float]]
    people: int


def summary(db: Session, days: int = 1, now: Optional[datetime] = None) -> UsageSummary:
    """Totals since the start of the UTC day `days - 1` days ago."""
    from app.models import AIUsage

    since = _day_start(now) - timedelta(days=max(days, 1) - 1)
    rows = db.query(AIUsage).filter(AIUsage.created_at >= since).all()

    def bucket(key: Callable[[Any], str]) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for r in rows:
            b = out.setdefault(key(r), {"calls": 0, "cost_usd": 0.0})
            b["calls"] += 1
            b["cost_usd"] = round(b["cost_usd"] + r.cost_usd, 6)
        return out

    return UsageSummary(
        since=since,
        calls=len(rows),
        input_tokens=sum(r.input_tokens for r in rows),
        output_tokens=sum(r.output_tokens for r in rows),
        cost_usd=round(sum(r.cost_usd for r in rows), 6),
        by_feature=bucket(lambda r: r.feature),
        by_model=bucket(lambda r: r.model),
        people=len({r.user_id for r in rows if r.user_id}),
    )
