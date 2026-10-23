"""Budgets Tabby can set, change and remove, plus a lookup of how each one is
doing this period."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.models import Budget
from app.services import budget_service, chat_tools, tabby_agent
from app.services.tabby_agent import Action, ask, err, ok

PER = {"weekly": "a week", "monthly": "a month", "yearly": "a year"}


def _money(value: float, currency: str = "USD") -> str:
    return f"${value:,.2f}" if currency == "USD" else f"{value:,.2f} {currency}"


def describe(level: str, target: str) -> str:
    return {
        "category": f"{target} spending",
        "merchant": f"purchases at {target}",
        "item": f"items matching “{target}”",
        "total": "everything you spend",
    }.get(level, target)


def name(budget: Budget) -> str:
    if budget.level == "total":
        return f"{budget.period} total budget"
    return f"{budget.target} budget"


def sentence(level: str, target: str, period: str, amount: float, currency="USD"):
    return f"Set a {_money(amount, currency)} {period} budget for {describe(level, target)}"


def _existing(db: Session, user_id: str, level: str, target: str, period: str):
    return (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id,
            Budget.level == level,
            Budget.target == target,
            Budget.period == period,
            Budget.deleted_at.is_(None),
        )
        .first()
    )


# --- lookup -----------------------------------------------------------------------


def budgets_overview(db: Session, user_id: str) -> Dict[str, Any]:
    """Every budget and how it's doing this period, worst first."""
    states = budget_service.evaluate_all(db, user_id)
    if not states:
        return {"status": "empty", "hint": "No budgets yet."}
    keep = (
        "label",
        "level",
        "target",
        "period",
        "limit",
        "spent",
        "remaining",
        "percent_used",
        "over_budget",
    )
    return ok({"budgets": [{k: s[k] for k in keep} for s in states]})


# --- add_budget -------------------------------------------------------------------


def prepare_add(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    checked = chat_tools.budget_scope(
        args.get("level") or "category",
        args.get("target") or args.get("category"),
        args.get("period"),
        args.get("amount"),
    )
    if checked["status"] != "ok":
        return checked
    level, target, period, amount = checked["data"]
    currency = args.get("currency") or "USD"
    current = _existing(db, user_id, level, target, period)
    if current and abs(current.amount - amount) < 0.005:
        return ask(f"That budget is already {_money(amount)}. Tell the person.")
    summary = (
        f"Change your {name(current)} from {_money(current.amount)} to "
        f"{_money(amount, currency)} {PER[period]}."
        if current
        else sentence(level, target, period, amount, currency) + "."
    )
    return ok(
        {
            "summary": summary,
            "step": {
                "level": level,
                "target": target,
                "period": period,
                "amount": amount,
                "currency": currency,
            },
        }
    )


def add_budget(db: Session, user_id: str, **step: Any) -> Dict:
    current = _existing(db, user_id, step["level"], step["target"], step["period"])
    before = current.amount if current else None
    result = chat_tools.add_budget(db, user_id, **step)
    if result.get("status") != "ok":
        return result
    data = dict(result["data"])
    data["open"] = "/app/budgets"
    data["undo"] = {"budget_id": data["budget_id"], "before": before}
    return ok(data)


def undo_add(db: Session, user_id: str, budget_id: str, before=None) -> Dict:
    budget = db.get(Budget, budget_id)
    if budget is None or budget.user_id != user_id:
        return err("That budget is gone.")
    if before is None:
        budget.deleted_at = datetime.now(timezone.utc)
    else:
        budget.amount = before
    db.commit()
    return ok({})


# --- change / remove ----------------------------------------------------------------


def _find(db: Session, user_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """The one budget they mean, or a question."""
    budgets: List[Budget] = budget_service.active_budgets(db, user_id)
    if not budgets:
        return ask("They have no budgets yet. Offer to set one.")
    term = str(args.get("budget") or args.get("target") or "").strip().lower()
    period = str(args.get("period") or "").strip().lower()
    if term in ("total", "overall", "everything", "all"):
        found = [b for b in budgets if b.level == "total"]
    elif term:
        found = [b for b in budgets if b.target.lower() == term] or [
            b for b in budgets if term in b.target.lower()
        ]
    else:
        found = budgets
    if period:
        found = [b for b in found if b.period == period] or found
    if not found:
        return ask(
            f"No budget matches '{term}'. Ask which one.",
            options=[f"{name(b)} ({_money(b.amount)} {b.period})" for b in budgets][:4],
        )
    if len(found) > 1:
        return ask(
            "More than one budget matches. Ask which one.",
            options=[f"{name(b)} ({_money(b.amount)} {b.period})" for b in found][:4],
        )
    return ok(found[0])


def prepare_change(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    found = _find(db, user_id, args)
    if found["status"] != "ok":
        return found
    budget: Budget = found["data"]
    changes: Dict[str, Any] = {}
    said = []
    if args.get("amount") not in (None, ""):
        try:
            amount = round(float(args["amount"]), 2)
        except (TypeError, ValueError):
            return ask("Ask for the new amount again.")
        if amount <= 0:
            return ask("Ask for a new amount above zero.")
        if abs(amount - budget.amount) >= 0.005:
            changes["amount"] = amount
            said.append(f"from {_money(budget.amount)} to {_money(amount)}")
    new_period = str(args.get("new_period") or "").strip().lower()
    if new_period:
        if new_period not in PER:
            return ask("Ask whether weekly, monthly or yearly.")
        if new_period != budget.period:
            if _existing(db, user_id, budget.level, budget.target, new_period):
                return ask(
                    f"They already have a {new_period} {name(budget)}. Ask whether to "
                    "change that one instead."
                )
            changes["period"] = new_period
            said.append(f"to {new_period}")
    if not changes:
        return ask("Nothing would change. Ask what the new amount should be.")
    period = changes.get("period", budget.period)
    summary = f"Change your {name(budget)} {' and '.join(said)}" + (
        f" ({PER[period]})." if "period" not in changes else "."
    )
    return ok(
        {"summary": summary, "step": {"budget_id": budget.id, "changes": changes}}
    )


def _owned(db: Session, user_id: str, budget_id: str):
    budget = db.get(Budget, budget_id)
    if budget is None or budget.user_id != user_id:
        return None
    return budget


def change_budget(db: Session, user_id: str, budget_id: str, changes: Dict) -> Dict:
    budget = _owned(db, user_id, budget_id)
    if budget is None or budget.deleted_at is not None:
        return err("That budget is gone.")
    before = {k: getattr(budget, k) for k in changes if k in ("amount", "period")}
    for key, value in changes.items():
        if key in ("amount", "period"):
            setattr(budget, key, value)
    db.commit()
    return ok(
        {"open": "/app/budgets", "undo": {"budget_id": budget.id, "before": before}}
    )


def undo_change(db: Session, user_id: str, budget_id: str, before: Dict) -> Dict:
    budget = _owned(db, user_id, budget_id)
    if budget is None:
        return err("That budget is gone.")
    for key, value in before.items():
        setattr(budget, key, value)
    db.commit()
    return ok({})


def prepare_remove(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    found = _find(db, user_id, args)
    if found["status"] != "ok":
        return found
    budget: Budget = found["data"]
    return ok(
        {
            "summary": f"Remove your {_money(budget.amount)} {budget.period} "
            f"{name(budget)}.",
            "step": {"budget_id": budget.id},
        }
    )


def remove_budget(db: Session, user_id: str, budget_id: str) -> Dict:
    budget = _owned(db, user_id, budget_id)
    if budget is None or budget.deleted_at is not None:
        return err("That budget is already gone.")
    budget.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({"open": "/app/budgets", "undo": {"budget_id": budget.id}})


def undo_remove(db: Session, user_id: str, budget_id: str) -> Dict:
    budget = _owned(db, user_id, budget_id)
    if budget is None:
        return err("That budget can't be found.")
    if _existing(db, user_id, budget.level, budget.target, budget.period):
        return err("A budget like it was set since, so it wasn't brought back.")
    budget.deleted_at = None
    db.commit()
    return ok({})


tabby_agent.register(
    Action("add_budget", prepare_add, add_budget, undo_add, "Setting up the budget…"),
    Action(
        "change_budget",
        prepare_change,
        change_budget,
        undo_change,
        "Finding that budget…",
    ),
    Action(
        "remove_budget",
        prepare_remove,
        remove_budget,
        undo_remove,
        "Finding that budget…",
    ),
)
