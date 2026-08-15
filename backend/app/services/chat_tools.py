"""Chat tools — thin, pre-built parameterized functions callable from Gemini.

Each function owns its own SQL (written by us, audited once, never built from
LLM output). User_id is ALWAYS injected here — the model cannot ask for other
users' data because the parameter is not in the function schema.

Every tool returns:
    {"status": "ok",    "data": {...}}
    {"status": "empty", "hint": "no receipts in that range"}   ← model composes graceful reply
    {"status": "error", "hint": "what to try instead"}

Never raise. Never return raw DB errors to the LLM (schema leaks).

TODO(Phase 2): migrate to google-genai 2.x SDK; legacy google-generativeai 0.8.3
is what we're on. Only the function-calling *envelope* lives in gemini_service;
this module will not change shape when the SDK swap happens.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Budget, Receipt, ReceiptLineItem, SplitGroup, SplitMember
from app.services import analytics_service
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.split_service import (
    calculate_even_split,
)
from app.services.split_service import create_split as _persist_split

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


def add_budget(
    db: Session,
    user_id: str,
    category: str,
    amount: float,
    currency: str = "USD",
) -> Dict[str, Any]:
    """Create or update the user's monthly budget for a category."""
    if not category:
        return _err("category is required. Ask the user which one.")

    cat = _normalize_category(category)
    if not cat:
        return _err(
            f"I don't recognize the category '{category}'. Try one of: {', '.join(CANONICAL_CATEGORIES)}."
        )

    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return _err(
            f"'{amount}' doesn't look like a number. Ask the user for a dollar amount."
        )
    if amt <= 0:
        return _err("Budget amount must be positive — ask the user for a real number.")

    budget = (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id,
            Budget.level == "category",
            Budget.target == cat,
            Budget.period == "monthly",
            Budget.deleted_at.is_(None),
        )
        .first()
    )
    created = False
    if budget:
        budget.amount = amt
    else:
        # The chat tool only ever creates monthly category budgets; the other
        # levels are set from the /budgets UI where the extra fields exist.
        budget = Budget(
            user_id=user_id,
            level="category",
            target=cat,
            period="monthly",
            amount=amt,
        )
        db.add(budget)
        created = True
    db.commit()
    db.refresh(budget)

    return _ok(
        {
            "budget_id": budget.id,
            "category": cat,
            "monthly_limit": round(amt, 2),  # tool contract: unchanged for the LLM
            "currency": currency or "USD",
            "created": created,
        }
    )


# ---------------------------------------------------------------------------
# Tool registry — name is what Gemini sees in function_call.name
# ---------------------------------------------------------------------------


TOOL_REGISTRY = {
    "get_spend_summary": get_spend_summary,
    "get_budget_status": get_budget_status,
    "list_receipts": list_receipts,
    "find_receipts": find_receipts,
    "create_split": create_split,
    "add_budget": add_budget,
}
