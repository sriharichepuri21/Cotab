"""Tabs and groups Tabby can manage: make a group, add people, rename it,
delete it, take a split off a tab, and remove a recorded payment. Plus two
lookups: who owes whom across every tab, and a group's share link."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Receipt, ReceiptSplit, Settlement, SplitGroup, SplitMember
from app.services import split_service, tabby_agent
from app.services.tabby_actions import _me, _resolve_people
from app.services.tabby_agent import Action, ask, err, ok


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _names(names: List[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _mine(db: Session, user_id: str) -> List[SplitGroup]:
    return split_service.groups_for_user(db, user_id)


def find_group(db: Session, user_id: str, term: Any) -> Dict[str, Any]:
    term = str(term or "").strip().lower()
    groups = _mine(db, user_id)
    if not term:
        return ask(
            "Ask which tab.", options=[g.name for g in groups if g.kind == "group"][:4]
        )
    found = [g for g in groups if g.id == term or g.name.strip().lower() == term] or [
        g for g in groups if term in g.name.strip().lower()
    ]
    if not found:
        return ask(
            f"No tab called '{term}'. Ask which one.",
            options=[g.name for g in groups][:4],
        )
    if len(found) > 1:
        return ask(
            "Several tabs match. Ask which one.", options=[g.name for g in found][:4]
        )
    return ok(found[0])


def _owner_only(group: SplitGroup, user_id: str) -> Optional[Dict[str, Any]]:
    if group.owner_id != user_id:
        return ask(
            f"Only the person who made {group.name} can change it. Tell the person."
        )
    return None


# --- lookups ----------------------------------------------------------------------


def balances(db: Session, user_id: str) -> Dict[str, Any]:
    """Who owes the person and whom they owe, across every tab."""
    rows = [
        {"person": r["person"], "direction": r["direction"], "amount": r["amount"]}
        for r in split_service.owner_net_balances(db, user_id)
        if r["amount"] >= 0.01
    ]
    if not rows:
        return {"status": "empty", "hint": "Everyone is even."}
    return ok({"people": rows})


def share_link(db: Session, user_id: str, group: str) -> Dict[str, Any]:
    """The link friends can open to see a tab (and join it)."""
    found = find_group(db, user_id, group)
    if found["status"] != "ok":
        return found
    tab = found["data"]
    return ok(
        {
            "tab": tab.name,
            "path": f"/share/{tab.share_code}",
            "note": "Give the person this link as a button with open_page; it is on "
            "the tab's page too.",
        }
    )


# --- create_group -----------------------------------------------------------------


def prepare_create_group(db: Session, user_id: str, args: Dict, plan) -> Dict:
    name = str(args.get("name") or "").strip()[:80]
    if not name:
        return ask("Ask what to call the group.")
    if any(g.name.strip().lower() == name.lower() for g in _mine(db, user_id)):
        return ask(
            f"They already have a tab called {name}. Ask whether to use it or pick "
            "another name."
        )
    _, my_name = _me(db, user_id)
    people = _resolve_people(db, user_id, list(args.get("people") or []))
    if people["status"] != "ok":
        return people
    people = split_service.clean_people(my_name, people["data"])
    if not people:
        return ask("Ask who's in the group.")
    plan.new_groups[name.lower()] = [n for n, _ in people]
    return ok(
        {
            "summary": f"Make a group called {name} with {_names([n for n, _ in people])}.",
            "step": {"name": name, "people": [[n, e] for n, e in people]},
        }
    )


def create_group(db: Session, user_id: str, name: str, people: List) -> Dict:
    _, my_name = _me(db, user_id)
    group = SplitGroup(
        owner_id=user_id, name=name, share_code=uuid.uuid4().hex, kind="group"
    )
    db.add(group)
    db.flush()
    db.add(SplitMember(group_id=group.id, name=my_name, user_id=user_id))
    for person, email in people:
        db.add(SplitMember(group_id=group.id, name=person, email=email))
    db.commit()
    return ok(
        {
            "group_id": group.id,
            "tab": group.name,
            "open": f"/app/groups/{group.id}",
            "undo": {"group_id": group.id},
        }
    )


def undo_create_group(db: Session, user_id: str, group_id: str) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.owner_id != user_id:
        return err("That group is gone.")
    if group.deleted_at is not None:
        return ok({})
    if not split_service.remove_group_if_empty(db, group_id):
        return err("It has splits on it now, so it was kept.")
    db.commit()
    return ok({})


# --- add_people -------------------------------------------------------------------


def prepare_add_people(db: Session, user_id: str, args: Dict, plan) -> Dict:
    found = find_group(db, user_id, args.get("group"))
    if found["status"] != "ok":
        return found
    group: SplitGroup = found["data"]
    if group.kind == "direct":
        return ask(
            f"{group.name} is a two-person friend tab. Offer to make a named group "
            "with everyone instead."
        )
    blocked = _owner_only(group, user_id)
    if blocked:
        return blocked
    people = _resolve_people(db, user_id, list(args.get("people") or []))
    if people["status"] != "ok":
        return people
    on = {m.name.strip().lower() for m in group.members if m.deleted_at is None}
    new = [(n, e) for n, e in people["data"] if n.strip().lower() not in on]
    if not new:
        return ask(f"They're already on {group.name}. Tell the person.")
    return ok(
        {
            "summary": f"Add {_names([n for n, _ in new])} to {group.name}.",
            "step": {"group_id": group.id, "people": [[n, e] for n, e in new]},
        }
    )


def add_people(db: Session, user_id: str, group_id: str, people: List) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.deleted_at is not None or group.owner_id != user_id:
        return err("That group is gone.")
    added = []
    for person, email in people:
        member = SplitMember(group_id=group.id, name=person, email=email)
        db.add(member)
        db.flush()
        added.append(member.id)
    db.commit()
    return ok(
        {
            "open": f"/app/groups/{group.id}",
            "tab": group.name,
            "undo": {"member_ids": added},
        }
    )


def undo_add_people(db: Session, user_id: str, member_ids: List[str]) -> Dict:
    now = datetime.now(timezone.utc)
    for member_id in member_ids:
        member = db.get(SplitMember, member_id)
        if member is None:
            continue
        group = db.get(SplitGroup, member.group_id)
        if group is None or group.owner_id != user_id:
            return err("That group isn't yours.")
        member.deleted_at = now
    db.commit()
    return ok({})


# --- rename / delete --------------------------------------------------------------


def prepare_rename(db: Session, user_id: str, args: Dict, plan) -> Dict:
    found = find_group(db, user_id, args.get("group"))
    if found["status"] != "ok":
        return found
    group: SplitGroup = found["data"]
    blocked = _owner_only(group, user_id)
    if blocked:
        return blocked
    new = str(args.get("new_name") or "").strip()[:80]
    if not new:
        return ask("Ask for the new name.")
    if new == group.name:
        return ask("That's already its name. Tell the person.")
    return ok(
        {
            "summary": f"Rename {group.name} to {new}.",
            "step": {"group_id": group.id, "name": new},
        }
    )


def rename_group(db: Session, user_id: str, group_id: str, name: str) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.deleted_at is not None or group.owner_id != user_id:
        return err("That group is gone.")
    before = group.name
    group.name = name
    db.commit()
    return ok(
        {
            "open": f"/app/groups/{group.id}",
            "undo": {"group_id": group.id, "name": before},
        }
    )


def undo_rename(db: Session, user_id: str, group_id: str, name: str) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.owner_id != user_id:
        return err("That group is gone.")
    group.name = name
    db.commit()
    return ok({})


def prepare_delete_group(db: Session, user_id: str, args: Dict, plan) -> Dict:
    found = find_group(db, user_id, args.get("group"))
    if found["status"] != "ok":
        return found
    group: SplitGroup = found["data"]
    blocked = _owner_only(group, user_id)
    if blocked:
        return blocked
    owed = split_service.simplify_debts(db, group.id)
    note = ""
    if owed:
        names = {m.id: m.name for m in group.members}
        first = owed[0]
        note = (
            f" Heads up: {names.get(first['from'], 'someone')} still owes "
            f"{names.get(first['to'], 'someone')} {_money(first['amount'])} on it."
        )
    return ok(
        {
            "summary": f"Delete the tab {group.name}.{note}",
            "step": {"group_id": group.id},
        }
    )


def delete_group(db: Session, user_id: str, group_id: str) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.deleted_at is not None or group.owner_id != user_id:
        return err("That tab is already gone.")
    group.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({"open": "/app/groups", "undo": {"group_id": group.id}})


def undo_delete_group(db: Session, user_id: str, group_id: str) -> Dict:
    group = db.get(SplitGroup, group_id)
    if group is None or group.owner_id != user_id:
        return err("That tab can't be found.")
    group.deleted_at = None
    db.commit()
    return ok({})


# --- remove_split -----------------------------------------------------------------


def prepare_remove_split(db: Session, user_id: str, args: Dict, plan) -> Dict:
    receipt = (
        db.query(Receipt)
        .filter(Receipt.id == args.get("receipt_id"), Receipt.user_id == user_id)
        .first()
    )
    if receipt is None:
        return err("That purchase wasn't found. Use find_purchases first.")
    mine = {g.id: g for g in _mine(db, user_id)}
    splits = [
        s
        for s in db.query(ReceiptSplit).filter(
            ReceiptSplit.receipt_id == receipt.id, ReceiptSplit.deleted_at.is_(None)
        )
        if s.group_id in mine
    ]
    term = str(args.get("group") or args.get("person") or "").strip().lower()
    if term:
        splits = [
            s
            for s in splits
            if term in mine[s.group_id].name.lower()
            or any(
                term in m.name.lower() and m.deleted_at is None
                for m in mine[s.group_id].members
            )
        ]
    if not splits:
        return ask("That purchase isn't split on any tab. Tell the person.")
    if len(splits) > 1:
        return ask(
            "It's split on more than one tab. Ask which one.",
            options=[mine[s.group_id].name for s in splits][:4],
        )
    split = splits[0]
    group = mine[split.group_id]
    plan.removed_splits.add((group.id, receipt.id))
    from app.services.tabby_receipt_actions import label

    return ok(
        {
            "summary": f"Take {label(receipt)} off {group.name}.",
            "step": {"split_id": split.id},
        }
    )


def remove_split(db: Session, user_id: str, split_id: str) -> Dict:
    split = db.get(ReceiptSplit, split_id)
    if split is None or split.deleted_at is not None:
        return err("That split is already gone.")
    if split.group_id not in {g.id for g in _mine(db, user_id)}:
        return err("That split isn't yours.")
    split_service.remove_split(db, split)
    db.commit()
    return ok({"open": f"/app/groups/{split.group_id}", "undo": {"split_id": split.id}})


def undo_remove_split(db: Session, user_id: str, split_id: str) -> Dict:
    split = db.get(ReceiptSplit, split_id)
    if split is None or split.group_id not in {g.id for g in _mine(db, user_id)}:
        return err("That split can't be found.")
    split_service.restore_split(db, split)
    db.commit()
    return ok({})


# --- remove_payment ---------------------------------------------------------------


def prepare_remove_payment(db: Session, user_id: str, args: Dict, plan) -> Dict:
    who = str(args.get("person") or "").strip().lower()
    if not who:
        return ask("Ask whose payment to remove.")
    rows = []
    for group in _mine(db, user_id):
        names = {m.id: m.name for m in group.members}
        me = {m.id for m in group.members if m.user_id == user_id}
        for payment in (
            db.query(Settlement)
            .filter(Settlement.group_id == group.id, Settlement.deleted_at.is_(None))
            .all()
        ):
            ends = {payment.from_member_id, payment.to_member_id}
            other = [names.get(i, "") for i in ends - me]
            if ends & me and any(who in o.lower() for o in other):
                rows.append((group, payment, names))
    term = str(args.get("group") or "").strip().lower()
    if term:
        rows = [r for r in rows if term in r[0].name.lower()] or rows
    if not rows:
        return ask("No recorded payment with them. Tell the person.")
    rows.sort(key=lambda r: r[1].created_at or 0, reverse=True)
    group, payment, names = rows[0]
    when = payment.created_at
    day = f" on {when:%b} {when.day}" if when else ""
    return ok(
        {
            "summary": f"Remove the {_money(payment.amount)} payment from "
            f"{names.get(payment.from_member_id)} to {names.get(payment.to_member_id)} "
            f"recorded{day}, on {group.name}.",
            "step": {"settlement_id": payment.id},
        }
    )


def remove_payment(db: Session, user_id: str, settlement_id: str) -> Dict:
    payment = db.get(Settlement, settlement_id)
    if payment is None or payment.deleted_at is not None:
        return err("That payment is already gone.")
    if payment.group_id not in {g.id for g in _mine(db, user_id)}:
        return err("That payment isn't yours.")
    payment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok(
        {
            "open": f"/app/groups/{payment.group_id}",
            "undo": {"settlement_id": payment.id},
        }
    )


def undo_remove_payment(db: Session, user_id: str, settlement_id: str) -> Dict:
    payment = db.get(Settlement, settlement_id)
    if payment is None or payment.group_id not in {g.id for g in _mine(db, user_id)}:
        return err("That payment can't be found.")
    payment.deleted_at = None
    db.commit()
    return ok({})


tabby_agent.register(
    Action(
        "create_group",
        prepare_create_group,
        create_group,
        undo_create_group,
        "Setting up the group…",
    ),
    Action(
        "add_people",
        prepare_add_people,
        add_people,
        undo_add_people,
        "Checking that group…",
    ),
    Action(
        "rename_group", prepare_rename, rename_group, undo_rename, "Checking that tab…"
    ),
    Action(
        "delete_group",
        prepare_delete_group,
        delete_group,
        undo_delete_group,
        "Checking that tab…",
    ),
    Action(
        "remove_split",
        prepare_remove_split,
        remove_split,
        undo_remove_split,
        "Finding that split…",
    ),
    Action(
        "remove_payment",
        prepare_remove_payment,
        remove_payment,
        undo_remove_payment,
        "Finding that payment…",
    ),
)
