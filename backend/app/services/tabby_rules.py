"""Standing rules: things Tabby does on its own whenever a new receipt comes in.

  "Split every Costco receipt with Ben"           -> split, store=Costco
  "Split the paneer from every Costco trip"        -> split, store=Costco, item=paneer
  "Put Uber in transport from now on"              -> categorize, store=Uber

Making or deleting a rule is a step the person approves like any other. When a
rule fires it goes through the same prepare/run path as a chat request, so
the same checks apply, it is logged with source "rule", the person gets a
note on their home screen, and one tap undoes it.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Insight, Receipt, TabbyRule
from app.services import tabby_agent
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.tabby_agent import Action, Plan, ask, err, ok

logger = logging.getLogger(__name__)

MAX_RULES = 20


def rules(db: Session, user_id: str, active_only: bool = False) -> List[TabbyRule]:
    query = db.query(TabbyRule).filter(
        TabbyRule.user_id == user_id, TabbyRule.deleted_at.is_(None)
    )
    if active_only:
        query = query.filter(TabbyRule.active.is_(True))
    return query.order_by(TabbyRule.created_at.asc()).all()


def for_prompt(db: Session, user_id: str) -> str:
    rows = rules(db, user_id)
    if not rows:
        return ""
    lines = "\n".join(
        f"- {r.summary}" + ("" if r.active else " (paused)") for r in rows
    )
    return "TABBY'S STANDING RULES FOR THEM:\n" + lines


def _names(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _when(store: Optional[str], category: Optional[str]) -> str:
    if store and category:
        return f"a {category} receipt from {store}"
    if store:
        return f"a {store} receipt"
    return f"a {category} receipt"


# --- create_rule / delete_rule ------------------------------------------------------


def prepare_create(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    store = " ".join(str(args.get("store") or "").split())[:128] or None
    category = None
    if args.get("category"):
        category = _normalize_category(str(args["category"]))
        if not category:
            return ask("Ask which category.", options=list(CANONICAL_CATEGORIES)[:4])
    if not store and not category:
        return ask("Ask which store (or category) the rule is for.")
    if len(rules(db, user_id)) >= MAX_RULES:
        return ask("They have the most rules Tabby keeps. Ask which one to delete.")
    what = str(args.get("action") or "").strip().lower()
    if what == "split":
        people = [str(p).strip() for p in args.get("people") or [] if str(p).strip()]
        if not people:
            return ask("Ask who to split with.")
        item = str(args.get("item") or "").strip()[:60] or None
        params = {"people": people, "item": item, "group": args.get("group") or None}
        thing = f"the {item} on it" if item else "it evenly"
        summary = (
            f"From now on, when {_when(store, category)} comes in, split {thing} "
            f"with {_names(people)}"
            + (f" on {params['group']}" if params["group"] else "")
            + " and let you know."
        )
    elif what == "categorize":
        target = _normalize_category(str(args.get("to_category") or ""))
        if not target:
            return ask(
                "Ask which category to put them in.",
                options=list(CANONICAL_CATEGORIES)[:4],
            )
        params = {"category": target}
        summary = (
            f"From now on, put every {_when(store, category).split(' ', 1)[1]} in "
            f"{target}."
        )
    else:
        return ask(
            "Ask what Tabby should do each time.",
            options=["Split it with someone", "Put it in a category"],
        )
    return ok(
        {
            "summary": summary,
            "step": {
                "summary": summary[:255],
                "store": store,
                "category": category,
                "action": what,
                "params": params,
            },
        }
    )


def create_rule(
    db: Session,
    user_id: str,
    summary: str,
    store: Optional[str],
    category: Optional[str],
    action: str,
    params: Dict[str, Any],
) -> Dict:
    row = TabbyRule(
        user_id=user_id,
        summary=summary,
        store=store,
        category=category,
        action=action,
        params=json.dumps(params),
        active=True,
    )
    db.add(row)
    db.commit()
    return ok({"rule_id": row.id, "open": "/app/tabby", "undo": {"rule_id": row.id}})


def _owned(db: Session, user_id: str, rule_id: str) -> Optional[TabbyRule]:
    row = db.get(TabbyRule, rule_id)
    return row if row is not None and row.user_id == user_id else None


def undo_create(db: Session, user_id: str, rule_id: str) -> Dict:
    row = _owned(db, user_id, rule_id)
    if row is None:
        return err("That rule is gone.")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({})


def prepare_delete(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    term = str(args.get("about") or "").strip().lower()
    rows = rules(db, user_id)
    found = [r for r in rows if term and term in r.summary.lower()] or (
        rows if len(rows) == 1 else []
    )
    if not found:
        return (
            ask("Ask which rule.", options=[r.summary[:60] for r in rows][:4])
            if rows
            else ask("They have no rules. Tell the person.")
        )
    if len(found) > 1:
        return ask("Ask which rule.", options=[r.summary[:60] for r in found][:4])
    return ok(
        {
            "summary": f"Stop this rule: {found[0].summary}",
            "step": {"rule_id": found[0].id},
        }
    )


def delete_rule(db: Session, user_id: str, rule_id: str) -> Dict:
    row = _owned(db, user_id, rule_id)
    if row is None or row.deleted_at is not None:
        return err("That rule is already gone.")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({"open": "/app/tabby", "undo": {"rule_id": row.id}})


def undo_delete(db: Session, user_id: str, rule_id: str) -> Dict:
    row = _owned(db, user_id, rule_id)
    if row is None:
        return err("That rule can't be found.")
    row.deleted_at = None
    db.commit()
    return ok({})


tabby_agent.register(
    Action("create_rule", prepare_create, create_rule, undo_create, "Setting that up…"),
    Action(
        "delete_rule", prepare_delete, delete_rule, undo_delete, "Finding that rule…"
    ),
)


# --- running rules -------------------------------------------------------------------


def _matches(rule: TabbyRule, receipt: Receipt) -> bool:
    if rule.store and rule.store.lower() not in (receipt.merchant or "").lower():
        return False
    if rule.category and rule.category != receipt.category:
        return False
    return True


def _step_for(db: Session, user_id: str, rule: TabbyRule, receipt: Receipt):
    params = json.loads(rule.params or "{}")
    plan = Plan()
    if rule.action == "split":
        args: Dict[str, Any] = {
            "receipt_id": receipt.id,
            "people": params.get("people") or [],
            "group": params.get("group"),
        }
        item = (params.get("item") or "").lower()
        if item:
            ids = [
                li.id
                for li in receipt.line_items
                if li.deleted_at is None
                and (li.total_price or 0) > 0
                and item in f"{li.description} {li.item_name or ''}".lower()
            ]
            if not ids:
                return None
            args["item_ids"] = ids
        result = tabby_agent.prepare("split_purchase", db, user_id, args, plan)
    elif rule.action == "categorize":
        result = tabby_agent.prepare(
            "recategorize",
            db,
            user_id,
            {"receipt_ids": [receipt.id], "category": params.get("category")},
            plan,
        )
    else:
        return None
    return plan.steps if result.get("status") == "added_to_plan" else None


def on_new_receipt(db: Session, user_id: str, receipt: Optional[Receipt]) -> List[str]:
    """Run every matching rule on a receipt that just landed. Never raises:
    a rule problem must not break adding the receipt. Returns the run ids."""
    if receipt is None or receipt.deleted_at is not None:
        return []
    runs = []
    try:
        for rule in rules(db, user_id, active_only=True):
            if not _matches(rule, receipt):
                continue
            steps = _step_for(db, user_id, rule, receipt)
            if not steps:
                continue
            result = tabby_agent.run(db, user_id, steps, source="rule")
            if result.get("status") != "ok":
                logger.info("Rule %s skipped: %s", rule.id, result.get("hint"))
                continue
            data = result["data"]
            rule.run_count = (rule.run_count or 0) + 1
            rule.last_run_at = datetime.now(timezone.utc)
            _note(db, user_id, rule, steps[0]["summary"], data)
            db.commit()
            runs.append(data["run_id"])
    except Exception:
        logger.exception("Running Tabby's rules failed (receipt=%s)", receipt.id)
        db.rollback()
    return runs


def _note(db: Session, user_id: str, rule: TabbyRule, summary: str, data: Dict) -> None:
    """A note on the home screen saying what Tabby did, with Undo."""
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    done = summary.replace("Split ", "Tabby split ", 1).replace(
        "Move ", "Tabby moved ", 1
    )
    db.add(
        Insight(
            user_id=user_id,
            kind="tabby_rule",
            dedupe_key=f"tabby_rule:{data['run_id']}",
            title="Tabby did this for you",
            body=done,
            data=json.dumps(
                {
                    "run_id": data["run_id"],
                    "open": data.get("open"),
                    "rule": rule.summary,
                }
            ),
            severity="info",
            observed_at=now,
            expires_at=now + timedelta(days=7),
        )
    )
