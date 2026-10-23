"""Chat tools — thin, pre-built parameterized functions callable from Gemini.

Each function owns its own SQL (written by us, audited once, never built from
LLM output). User_id is ALWAYS injected here — the model cannot ask for other
users' data because the parameter is not in the function schema.

Every tool returns:
    {"status": "ok",    "data": {...}}
    {"status": "empty", "hint": "no receipts in that range"}   ← model composes graceful reply
    {"status": "error", "hint": "what to try instead"}

Never raise. Never return raw DB errors to the LLM (schema leaks).

Tool declarations (what the model sees) live in chat_ai; the loop that calls
these lives in chat_service.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Budget, Receipt, ReceiptLineItem, SplitGroup, SplitMember
from app.services import analytics_service, tabby_actions
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.split_service import (
    calculate_even_split,
)
from app.services.split_service import create_split as _persist_split
from app.services.sql_executor import execute_validated_sql
from app.services.sql_safety import SqlSafetyError, validate_and_scope_sql

# ---------------------------------------------------------------------------
# Result envelope helpers
# ---------------------------------------------------------------------------


def _ok(data: Any) -> Dict[str, Any]:
    return {"status": "ok", "data": data}


def _empty(hint: str) -> Dict[str, Any]:
    return {"status": "empty", "hint": hint}


def _err(hint: str) -> Dict[str, Any]:
    return {"status": "error", "hint": hint}


# ---------------------------------------------------------------------------
# Date helpers — parse "YYYY-MM-DD" from the LLM, default to sensible ranges
# ---------------------------------------------------------------------------


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _month_range(yyyymm: Optional[str]) -> tuple[date, date]:
    """Parse 'YYYY-MM' into [first_day, next_month_first_day)."""
    today = datetime.now(timezone.utc).date()
    if not yyyymm:
        first = today.replace(day=1)
    else:
        try:
            first = datetime.strptime(yyyymm[:7], "%Y-%m").date().replace(day=1)
        except (ValueError, TypeError):
            first = today.replace(day=1)
    if first.month == 12:
        nxt = first.replace(year=first.year + 1, month=1, day=1)
    else:
        nxt = first.replace(month=first.month + 1, day=1)
    return first, nxt


def _default_range(days: int = 30) -> tuple[date, date]:
    end = datetime.now(timezone.utc).date() + timedelta(days=1)
    return end - timedelta(days=days + 1), end


# ---------------------------------------------------------------------------
# Tool 1: get_spend_summary
# ---------------------------------------------------------------------------


def get_spend_summary(
    db: Session,
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """Total spend (sum, count, by-category breakdown) in a date range.

    Defaults to the last 30 days when the LLM doesn't pass dates.
    """
    start = _parse_date(start_date)
    end = _parse_date(end_date)
    if not start or not end:
        start, end = _default_range(30)
    elif end < start:
        start, end = end, start  # swapped args — be permissive

    # Inclusive end: query uses < end_exclusive
    end_exclusive = end + timedelta(days=1)

    # Shared with the dashboard so the assistant and the home page can never
    # quote different totals for the same question.
    q = analytics_service.spend_query(db, user_id, start, end_exclusive)

    cat = _normalize_category(category)
    if category and not cat:
        return _err(
            f"I don't recognize the category '{category}'. Try one of: {', '.join(CANONICAL_CATEGORIES)}."
        )
    if cat:
        q = q.filter(Receipt.category == cat)

    rows = q.all()
    if not rows:
        return _empty(
            f"No receipts found between {start.isoformat()} and {end.isoformat()}"
            + (f" in category '{cat}'" if cat else "")
            + ". User may need to upload more receipts or widen the date range."
        )

    total = sum(r.total or 0 for r in rows)
    by_cat: Dict[str, float] = {}
    for r in rows:
        by_cat[r.category] = by_cat.get(r.category, 0.0) + (r.total or 0)

    top = sorted(by_cat.items(), key=lambda kv: -kv[1])[:5]
    currency = rows[0].currency or "USD"

    return _ok(
        {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "category_filter": cat,
            "receipt_count": len(rows),
            "total_spent": round(total, 2),
            "currency": currency,
            "top_categories": [{"category": c, "amount": round(a, 2)} for c, a in top],
        }
    )


# ---------------------------------------------------------------------------
# Tool 2: get_budget_status
# ---------------------------------------------------------------------------


def get_budget_status(
    db: Session,
    user_id: str,
    category: str,
    month: Optional[str] = None,
) -> Dict[str, Any]:
    """Compare spend in `category` vs the user's monthly budget."""
    if not category:
        return _err("Need a category. Ask the user which one (e.g. 'groceries').")
    cat = _normalize_category(category)
    if not cat:
        return _err(
            f"I don't recognize the category '{category}'. Try one of: {', '.join(CANONICAL_CATEGORIES)}."
        )

    budget = (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id,
            Budget.level == "category",
            Budget.target == cat,
            Budget.deleted_at.is_(None),
        )
        .first()
    )
    if not budget:
        return _empty(
            f"No budget set for '{cat}' yet. Offer to call add_budget to create one."
        )

    first, nxt = _month_range(month)
    spend = (
        db.query(func.coalesce(func.sum(Receipt.total), 0.0))
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.category == cat,
            Receipt.purchased_at
            >= datetime.combine(first, datetime.min.time(), tzinfo=timezone.utc),
            Receipt.purchased_at
            < datetime.combine(nxt, datetime.min.time(), tzinfo=timezone.utc),
        )
        .scalar()
        or 0.0
    )

    limit = float(budget.amount)
    pct = (spend / limit * 100.0) if limit > 0 else 0.0
    remaining = limit - spend

    return _ok(
        {
            "category": cat,
            "month": first.strftime("%Y-%m"),
            "budget_limit": round(limit, 2),
            "spent": round(spend, 2),
            "percent_used": round(pct, 1),
            "remaining": round(remaining, 2),
            "over_budget": spend > limit,
        }
    )


# ---------------------------------------------------------------------------
# Tool 3: list_receipts
# ---------------------------------------------------------------------------


def list_receipts(
    db: Session,
    user_id: str,
    limit: int = 10,
    merchant: Optional[str] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Most recent receipts for the user, newest first."""
    try:
        limit_int = max(1, min(int(limit), 50))  # cap at 50 no matter what LLM says
    except (TypeError, ValueError):
        limit_int = 10

    q = db.query(Receipt).filter(
        Receipt.user_id == user_id,
        Receipt.deleted_at.is_(None),
    )
    if merchant:
        q = q.filter(Receipt.merchant.ilike(f"%{merchant.strip()}%"))
    if status:
        q = q.filter(Receipt.status == status.strip().lower())
    q = q.order_by(Receipt.purchased_at.desc().nullslast(), Receipt.created_at.desc())
    rows = q.limit(limit_int).all()

    if not rows:
        hint = "No receipts match"
        if merchant:
            hint += f" for merchant like '{merchant}'"
        if status:
            hint += f" with status '{status}'"
        return _empty(hint + ".")

    return _ok(
        {
            "count": len(rows),
            "receipts": [
                {
                    "id": r.id,
                    "merchant": r.merchant or "(unparsed)",
                    "total": round(r.total or 0, 2),
                    "currency": r.currency or "USD",
                    "category": r.category or "other",
                    "status": r.status,
                    "purchased_at": (
                        r.purchased_at.date().isoformat() if r.purchased_at else None
                    ),
                }
                for r in rows
            ],
        }
    )


# ---------------------------------------------------------------------------
# Tool 4: find_receipts (free-text search)
# ---------------------------------------------------------------------------


def find_receipts(
    db: Session,
    user_id: str,
    search_text: str,
    limit: int = 10,
) -> Dict[str, Any]:
    """Search receipts by merchant name or line-item description."""
    if not search_text or not search_text.strip():
        return _err("search_text is empty — ask the user what to search for.")

    term = search_text.strip()
    try:
        limit_int = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit_int = 10

    # Search receipt merchant OR any line-item description
    receipt_q = db.query(Receipt).filter(
        Receipt.user_id == user_id,
        Receipt.deleted_at.is_(None),
        Receipt.merchant.ilike(f"%{term}%"),
    )
    item_q = (
        db.query(Receipt)
        .join(ReceiptLineItem, ReceiptLineItem.receipt_id == Receipt.id)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            ReceiptLineItem.description.ilike(f"%{term}%"),
        )
    )

    rows = (
        receipt_q.union(item_q)
        .order_by(Receipt.purchased_at.desc().nullslast(), Receipt.created_at.desc())
        .limit(limit_int)
        .all()
    )

    if not rows:
        return _empty(
            f"No receipts match '{term}'. Try a different merchant or item name."
        )

    return _ok(
        {
            "query": term,
            "count": len(rows),
            "receipts": [
                {
                    "id": r.id,
                    "merchant": r.merchant or "(unparsed)",
                    "total": round(r.total or 0, 2),
                    "currency": r.currency or "USD",
                    "category": r.category or "other",
                    "purchased_at": (
                        r.purchased_at.date().isoformat() if r.purchased_at else None
                    ),
                }
                for r in rows
            ],
        }
    )


# ---------------------------------------------------------------------------
# Phase 7B read tools (feature-gated at declaration, dispatch, and tool levels)
# ---------------------------------------------------------------------------


def execute_sql(
    db: Session,
    user_id: str,
    sql: str,
    user_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate, user-scope, and run one analytical SELECT."""
    from app.config.settings import get_settings

    if not get_settings().execute_sql_is_enabled_for(user_id, user_email):
        return _err("Schema-aware queries are not enabled for this account.")
    from app.services.rate_limiter import (
        RateLimitExceeded,
        RateLimitUnavailable,
        check_rate_limit,
    )

    try:
        check_rate_limit(
            "execute-sql",
            user_id,
            get_settings().rate_limit_execute_sql_per_hour,
        )
    except RateLimitExceeded:
        return _err("Schema-aware query limit reached. Try again in about an hour.")
    except RateLimitUnavailable:
        return _err(
            "Schema-aware queries are temporarily unavailable. Try again shortly."
        )
    try:
        validated_sql = validate_and_scope_sql(sql)
    except SqlSafetyError as exc:
        return _err(
            f"SQL was rejected by the safety policy: {exc}. "
            "Revise it as one SELECT over the documented tables and columns."
        )

    result = execute_validated_sql(db, user_id, validated_sql)
    if result.status != "ok":
        return _err(result.message or "The read-only query could not be executed.")
    return _ok(
        {
            "sql": validated_sql,
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
            "truncated": result.truncated,
        }
    )


def line_items_search(
    db: Session,
    user_id: str,
    search_text: str,
    limit: int = 50,
    user_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Fast substring search over normalized receipt line-item rows."""
    from app.config.settings import get_settings

    if not get_settings().execute_sql_is_enabled_for(user_id, user_email):
        return _err("Schema-aware queries are not enabled for this account.")
    term = (search_text or "").strip()
    if not term:
        return _err("search_text is empty — ask the user which item to find.")
    try:
        limit_int = max(1, min(int(limit), 100))
    except (TypeError, ValueError):
        limit_int = 50

    statement = (
        select(
            ReceiptLineItem.id.label("line_item_id"),
            ReceiptLineItem.description,
            ReceiptLineItem.item_name,
            ReceiptLineItem.item_code,
            ReceiptLineItem.quantity,
            ReceiptLineItem.unit_price,
            ReceiptLineItem.total_price,
            Receipt.id.label("receipt_id"),
            Receipt.merchant,
            Receipt.purchased_at,
            Receipt.currency,
            Receipt.category,
        )
        .join(Receipt, Receipt.id == ReceiptLineItem.receipt_id)
        .where(
            ReceiptLineItem.user_id == user_id,
            Receipt.user_id == user_id,
            ReceiptLineItem.deleted_at.is_(None),
            Receipt.deleted_at.is_(None),
            or_(
                func.lower(ReceiptLineItem.description).like(f"%{term.lower()}%"),
                func.lower(ReceiptLineItem.item_name).like(f"%{term.lower()}%"),
            ),
        )
        .order_by(Receipt.purchased_at.desc().nullslast(), Receipt.created_at.desc())
        .limit(limit_int)
    )
    rows = db.execute(statement).mappings().all()
    executed_sql = str(statement.compile(dialect=db.get_bind().dialect))
    if not rows:
        return _empty(f"No line items contain '{term}'. Try a broader item name.")

    items = []
    for row in rows:
        item = dict(row)
        if item["purchased_at"] is not None:
            item["purchased_at"] = item["purchased_at"].isoformat()
        items.append(item)
    return _ok(
        {
            "query": term,
            "sql": executed_sql,
            "row_count": len(items),
            "items": items,
        }
    )


# ---------------------------------------------------------------------------
# Tool 5: create_split
# ---------------------------------------------------------------------------


def create_split(
    db: Session,
    user_id: str,
    receipt_id: str,
    member_names: List[str],
    style: str = "even",
) -> Dict[str, Any]:
    """Split a receipt evenly with named friends (no-account members).

    Creates a fresh single-purpose SplitGroup per call. Itemized splits come
    after Phase 1; style is accepted for forward-compatibility but "even" is
    the only supported value today.
    """
    if style and style.lower() != "even":
        return _err(
            f"Split style '{style}' isn't supported yet — only 'even' splits are available."
        )

    names = [n.strip() for n in (member_names or []) if n and n.strip()]
    if not names:
        return _err("member_names is empty — ask the user who to split with.")

    receipt = (
        db.query(Receipt)
        .filter(
            Receipt.id == receipt_id,
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if not receipt:
        return _empty(
            f"No receipt with id '{receipt_id}' found for this account. "
            "Try list_receipts first to get the right id."
        )

    total = float(receipt.total or 0.0)
    if total <= 0:
        return _err(
            f"Receipt '{receipt.merchant or receipt_id}' has no total yet — status is '{receipt.status}'. "
            "Wait for extraction to finish before splitting."
        )

    payer_name = "You"
    everyone = [payer_name] + names

    # Each split gets its own group — keeps membership scoped to this event,
    # matches Expensify's "one report, one split" mental model.
    group = SplitGroup(
        owner_id=user_id,
        name=f"Split — {receipt.merchant or 'receipt'}",
    )
    db.add(group)
    db.flush()

    members = [
        SplitMember(
            group_id=group.id,
            name=n,
            user_id=user_id if n == payer_name else None,
        )
        for n in everyone
    ]
    db.add_all(members)
    db.flush()
    payer = members[0]

    per_person = calculate_even_split(total, len(everyone))
    shares = {m.id: per_person for m in members if m.id != payer.id}

    split = _persist_split(
        db=db,
        group_id=group.id,
        receipt_id=receipt.id,
        paid_by_member_id=payer.id,
        shares=shares,
    )

    return _ok(
        {
            "split_id": split.id,
            "group_id": group.id,
            "receipt_id": receipt.id,
            "merchant": receipt.merchant or "(unparsed)",
            "total": round(total, 2),
            "currency": receipt.currency or "USD",
            "member_count": len(everyone),
            "per_person": per_person,
            "owes": [
                {"name": m.name, "amount": per_person}
                for m in members
                if m.id != payer.id
            ],
            "share_code": group.share_code,
        }
    )


# ---------------------------------------------------------------------------
# Tool 6: add_budget (upsert category budget)
# ---------------------------------------------------------------------------


BUDGET_LEVELS = ("category", "merchant", "item", "total")
BUDGET_PERIODS = ("weekly", "monthly", "yearly")


def budget_scope(level: Any, target: Any, period: Any, amount: Any) -> Dict[str, Any]:
    """Check a budget's level, target, period and amount; returns them cleaned
    as (level, target, period, amount), or an error saying what to ask."""
    level = str(level or "category").strip().lower()
    if level in ("store", "shop"):
        level = "merchant"
    if level not in BUDGET_LEVELS:
        return _err(f"level must be one of: {', '.join(BUDGET_LEVELS)}.")
    period = str(period or "monthly").strip().lower()
    if period not in BUDGET_PERIODS:
        return _err(f"period must be one of: {', '.join(BUDGET_PERIODS)}.")

    raw = str(target or "").strip()
    if level == "total":
        scope = ""
    elif not raw:
        return _err(
            f"A {level} budget needs a {'store' if level == 'merchant' else level}. Ask the user."
        )
    elif level == "category":
        scope = _normalize_category(raw)
        if not scope:
            return _err(
                f"'{raw}' isn't a category ({', '.join(CANONICAL_CATEGORIES)}). "
                "If it's a product, use level 'item'; if it's a store, use level 'merchant'."
            )
    else:
        scope = raw[:255]

    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return _err(
            f"'{amount}' doesn't look like a number. Ask the user for an amount."
        )
    if amt <= 0:
        return _err("Budget amount must be positive — ask the user for a real number.")
    return _ok((level, scope, period, amt))


def add_budget(
    db: Session,
    user_id: str,
    category: str = "",
    amount: float = 0,
    currency: str = "USD",
    level: str = "category",
    target: str = "",
    period: str = "monthly",
) -> Dict[str, Any]:
    """Create or update a budget, at any level the Budgets page offers:

    - category: one of the canonical categories (groceries, dining, ...)
    - merchant: a store name, matched as a substring ("Costco")
    - item: an item description, matched as a substring ("coffee", "milk")
    - total: everything spent in the period

    `category` is kept for older callers: it is the target of a category
    budget. Re-saving the same level, target and period updates it.
    """
    checked = budget_scope(level, target or category, period, amount)
    if checked["status"] != "ok":
        return checked
    level, scope, period, amt = checked["data"]

    budget = (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id,
            Budget.level == level,
            Budget.target == scope,
            Budget.period == period,
            Budget.deleted_at.is_(None),
        )
        .first()
    )
    created = False
    if budget:
        budget.amount = amt
    else:
        budget = Budget(
            user_id=user_id, level=level, target=scope, period=period, amount=amt
        )
        db.add(budget)
        created = True
    db.commit()
    db.refresh(budget)

    return _ok(
        {
            "budget_id": budget.id,
            "level": level,
            "target": scope,
            "category": scope if level == "category" else None,
            "period": period,
            "limit": round(amt, 2),
            "monthly_limit": round(amt, 2) if period == "monthly" else None,
            "currency": currency or "USD",
            "created": created,
        }
    )


# ---------------------------------------------------------------------------
# Tool registry — name is what Gemini sees in function_call.name
# ---------------------------------------------------------------------------


def get_receipt(db: Session, user_id: str, receipt_id: str) -> Dict[str, Any]:
    """One receipt in full: store, date, totals, how it was added, and items."""
    r = (
        db.query(Receipt)
        .filter(
            Receipt.id == (receipt_id or "").strip(),
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if r is None:
        return _empty("No receipt with that id on this tab.")
    items = (
        db.query(ReceiptLineItem)
        .filter(
            ReceiptLineItem.receipt_id == r.id, ReceiptLineItem.deleted_at.is_(None)
        )
        .all()
    )
    return _ok(
        {
            "id": r.id,
            "merchant": r.merchant or "(unparsed)",
            "purchased_at": r.purchased_at.isoformat() if r.purchased_at else None,
            "total": round(r.total or 0, 2),
            "subtotal": round(r.subtotal or 0, 2),
            "tax": round(r.tax or 0, 2),
            "currency": r.currency or "USD",
            "category": r.category or "other",
            "status": r.status,
            "added_by": {"tap": "Apple Pay tap", "email": "forwarded email"}.get(
                r.source or "", "scan or upload"
            ),
            "items": [
                {
                    "line_id": li.id,
                    "description": li.description,
                    "name": li.item_name,
                    "quantity": li.quantity,
                    "total_price": round(li.total_price or 0, 2),
                }
                for li in items
            ],
        }
    )


def _lazy(module: str, name: str, db: Session, user_id: str, **kwargs: Any):
    """Lookups that live with Tabby's actions (imported late: they import this)."""
    import importlib

    fn = getattr(importlib.import_module(f"app.services.{module}"), name)
    return fn(db, user_id, **kwargs)


TOOL_REGISTRY = {
    "get_receipt": get_receipt,
    "get_spend_summary": get_spend_summary,
    "get_budget_status": get_budget_status,
    "list_receipts": list_receipts,
    "find_receipts": find_receipts,
    "create_split": create_split,
    "add_budget": add_budget,
    "execute_sql": execute_sql,
    "line_items_search": line_items_search,
    # What Tabby can find and do anywhere in the app (tabby_actions.py).
    "find_purchases": tabby_actions.find_purchases,
    "find_people": tabby_actions.find_people,
    "split_purchase": tabby_actions.split_purchase,
    "settle_up": tabby_actions.settle_up,
    "receipts_to_check": lambda db, user_id, **kw: _lazy(
        "tabby_receipt_actions", "receipts_to_check", db, user_id, **kw
    ),
    "budgets_overview": lambda db, user_id, **kw: _lazy(
        "tabby_budget_actions", "budgets_overview", db, user_id, **kw
    ),
    "balances": lambda db, user_id, **kw: _lazy(
        "tabby_tab_actions", "balances", db, user_id, **kw
    ),
    "share_link": lambda db, user_id, **kw: _lazy(
        "tabby_tab_actions", "share_link", db, user_id, **kw
    ),
}
