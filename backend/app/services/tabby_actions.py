"""What Tabby can find and do in the app on someone's behalf.

Finding (read-only, run straight away):
  find_purchases  receipts by item, store, date or amount, with their items
  find_people     people this person has split with, and the tabs they're on

Doing (always a proposal the person confirms with a button):
  split_purchase  split a whole receipt, or specific items on it, with people
  settle_up       record that someone paid (or that you paid them)

Each action has a `prepare_*` step that runs when Tabby proposes it: it checks
everything can be done, works out the exact amounts, and writes the sentence
on the Confirm card. Anything unclear comes back as an error telling Tabby
what to ask, so it asks instead of guessing.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    Settlement,
    SplitGroup,
    User,
)
from app.services import split_service


def _ok(data: Any) -> Dict[str, Any]:
    return {"status": "ok", "data": data}


def _ask(hint: str, **data: Any) -> Dict[str, Any]:
    """Not an error in the app: Tabby needs the person to clarify something."""
    return {"status": "needs_clarification", "hint": hint, "data": data}


def _err(hint: str) -> Dict[str, Any]:
    return {"status": "error", "hint": hint}


def _money(value: float, currency: str = "USD") -> str:
    return f"${value:,.2f}" if currency == "USD" else f"{value:,.2f} {currency}"


def _day(value: Optional[datetime]) -> str:
    if not value:
        return "no date"
    return f"{value:%b} {value.day}"


def _parse_day(text: Optional[str]) -> Optional[date]:
    if not text:
        return None
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def _me(db: Session, user_id: str) -> Tuple[User, str]:
    user = db.get(User, user_id)
    name = (user.full_name or "").strip() or (user.email or "me").split("@")[0]
    return user, name


def _line_name(line: ReceiptLineItem) -> str:
    return (line.item_name or line.description or "Item").strip()


# --- finding ----------------------------------------------------------------


def find_purchases(
    db: Session,
    user_id: str,
    item: Optional[str] = None,
    store: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    amount: Optional[float] = None,
    limit: int = 8,
) -> Dict[str, Any]:
    """Receipts matching any mix of item, store, day or date range and total."""
    query = db.query(Receipt).filter(
        Receipt.user_id == user_id,
        Receipt.deleted_at.is_(None),
        Receipt.status.in_(["extracted", "reviewed"]),
    )
    if store:
        query = query.filter(
            func.lower(Receipt.merchant).like(f"%{store.strip().lower()}%")
        )
    day = _parse_day(date)
    start = day or _parse_day(date_from)
    end = day or _parse_day(date_to)
    if start:
        query = query.filter(
            Receipt.purchased_at >= datetime.combine(start, datetime.min.time())
        )
    if end:
        query = query.filter(
            Receipt.purchased_at
            < datetime.combine(end + timedelta(days=1), datetime.min.time())
        )
    if amount is not None:
        try:
            value = float(amount)
            query = query.filter(Receipt.total.between(value - 0.5, value + 0.5))
        except (TypeError, ValueError):
            pass
    term = (item or "").strip().lower()
    if term:
        matching = (
            db.query(ReceiptLineItem.receipt_id)
            .filter(
                ReceiptLineItem.user_id == user_id,
                ReceiptLineItem.deleted_at.is_(None),
                or_(
                    func.lower(ReceiptLineItem.description).like(f"%{term}%"),
                    func.lower(ReceiptLineItem.item_name).like(f"%{term}%"),
                ),
            )
            .distinct()
        )
        query = query.filter(Receipt.id.in_(matching))
    try:
        limit = max(1, min(int(limit), 20))
    except (TypeError, ValueError):
        limit = 8
    receipts = (
        query.order_by(Receipt.purchased_at.desc().nullslast()).limit(limit).all()
    )
    if not receipts:
        return {
            "status": "empty",
            "hint": "No purchase matches. Ask the person for another detail "
            "(the store, the day, or what the item was called on the receipt).",
        }
    out = []
    for receipt in receipts:
        lines = [li for li in receipt.line_items if li.deleted_at is None]
        if term:
            shown = [
                li
                for li in lines
                if term in (li.description or "").lower()
                or term in (li.item_name or "").lower()
            ]
        else:
            shown = lines[:12]
        tabs = (
            db.query(SplitGroup.name)
            .join(ReceiptSplit, ReceiptSplit.group_id == SplitGroup.id)
            .filter(
                ReceiptSplit.receipt_id == receipt.id, ReceiptSplit.deleted_at.is_(None)
            )
            .all()
        )
        out.append(
            {
                "receipt_id": receipt.id,
                "store": receipt.merchant,
                "date": (
                    receipt.purchased_at.date().isoformat()
                    if receipt.purchased_at
                    else None
                ),
                "total": round(receipt.total or 0, 2),
                "currency": receipt.currency or "USD",
                "item_count": len(lines),
                "items": [
                    {
                        "line_id": li.id,
                        "name": _line_name(li),
                        "quantity": li.quantity,
                        "price": round(li.total_price or 0, 2),
                    }
                    for li in shown
                ],
                "already_split_on": [t[0] for t in tabs],
            }
        )
    return _ok({"count": len(out), "purchases": out})


def _known_people(db: Session, user_id: str) -> Dict[str, Dict[str, Any]]:
    """Everyone this person has split with, by lowercase name."""
    people: Dict[str, Dict[str, Any]] = {}
    for group in split_service.groups_for_user(db, user_id):
        for member in group.members:
            if member.deleted_at is not None or member.user_id == user_id:
                continue
            key = member.name.strip().lower()
            entry = people.setdefault(
                key, {"name": member.name.strip(), "emails": set(), "tabs": []}
            )
            if member.email:
                entry["emails"].add(member.email.lower())
            entry["tabs"].append(
                {"tab": group.name, "kind": group.kind or "group", "group_id": group.id}
            )
    return people


def find_people(db: Session, user_id: str, name: str) -> Dict[str, Any]:
    """People this person has split with whose name matches."""
    term = (name or "").strip().lower()
    if not term:
        return _err("Say whose name to look for.")
    people = _known_people(db, user_id)
    exact = [p for k, p in people.items() if k == term]
    close = [
        p
        for k, p in people.items()
        if k != term and (k.startswith(term) or term in k.split())
    ]
    found = exact or close
    if not found:
        return {
            "status": "empty",
            "hint": f"No one called {name} on any tab yet. That's fine for a split: "
            "they'll be added as someone new.",
        }
    return _ok(
        {
            "people": [
                {
                    "name": p["name"],
                    "tabs": [t["tab"] for t in p["tabs"]],
                    "has_email": bool(p["emails"]),
                }
                for p in found
            ],
            "exact": bool(exact),
        }
    )


# --- split_purchase ---------------------------------------------------------


def _resolve_people(db: Session, user_id: str, names: List[str]) -> Dict[str, Any]:
    known = _known_people(db, user_id)
    resolved: List[Tuple[str, Optional[str]]] = []
    for raw in names or []:
        name = (raw or "").strip()
        if not name:
            continue
        match = known.get(name.lower())
        if not match:
            starts = [p for k, p in known.items() if k.split()[0] == name.lower()]
            if len(starts) > 1:
                return _ask(
                    f"More than one person matches '{name}'. Ask which one.",
                    options=[p["name"] for p in starts][:4],
                )
            match = starts[0] if starts else None
        if match and len(match["emails"]) > 1:
            return _ask(
                f"There are different people called {match['name']}. Ask which one "
                "(they have different emails).",
                options=[f"{match['name']} ({e})" for e in sorted(match["emails"])][:4],
            )
        email = next(iter(match["emails"]), None) if match else None
        resolved.append((match["name"] if match else name, email))
    if not resolved:
        return _ask("Ask who to split with.")
    return _ok(resolved)


def _target_tab(
    db: Session, user_id: str, my_name: str, people: List[tuple], group: Optional[str]
) -> Dict[str, Any]:
    """The tab to put the split on: a named group if asked, else the friend tab."""
    if group:
        term = group.strip().lower()
        groups = [
            g
            for g in split_service.groups_for_user(db, user_id)
            if g.id == group or g.name.strip().lower() == term
        ] or [
            g
            for g in split_service.groups_for_user(db, user_id)
            if term in g.name.strip().lower()
        ]
        if not groups:
            return _ask(
                f"No group called '{group}'. Ask which group, or offer a friend split."
            )
        if len(groups) > 1:
            return _ask(
                "Several groups match. Ask which one.",
                options=[g.name for g in groups][:4],
            )
        tab = groups[0]
        names = {m.name.strip().lower() for m in tab.members if m.deleted_at is None}
        missing = [n for n, _ in people if n.strip().lower() not in names]
        if missing:
            return _ask(
                f"{', '.join(missing)} isn't on {tab.name}. Ask whether to split on a "
                "friend tab instead, or check the name."
            )
        return _ok({"group": tab, "new": False})
    tab = split_service.find_direct_tab(db, user_id, people)
    return _ok(
        {
            "group": tab,
            "new": tab is None,
            "name": (
                tab.name
                if tab
                else split_service.direct_tab_name([n for n, _ in people])
            ),
        }
    )


def prepare_split(db: Session, user_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Check a split can be done and work out who owes what, without saving."""
    receipt = (
        db.query(Receipt)
        .filter(
            Receipt.id == args.get("receipt_id"),
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if not receipt:
        return _err(
            "That purchase wasn't found. Use find_purchases to get the right one."
        )
    if (receipt.total or 0) <= 0:
        return _err("That receipt has no total yet, so it can't be split.")
    user, my_name = _me(db, user_id)
    people = _resolve_people(db, user_id, list(args.get("people") or []))
    if people["status"] != "ok":
        return people
    people = split_service.clean_people(my_name, people["data"])
    if not people:
        return _ask("Ask who to split with (not the person themselves).")

    lines = [
        li
        for li in receipt.line_items
        if li.deleted_at is None and (li.total_price or 0) > 0
    ]
    item_ids = [i for i in (args.get("item_ids") or []) if i]
    valid = {li.id for li in lines}
    if set(item_ids) - valid:
        return _err(
            "Some of those items aren't on that receipt. Use find_purchases to get "
            "the line_ids of the items on it."
        )
    chosen = [li for li in lines if li.id in item_ids]

    payer_arg = (args.get("paid_by") or "me").strip()
    everyone = [my_name] + [n for n, _ in people]
    if payer_arg.lower() in ("me", "you", "i", my_name.lower()):
        payer = my_name
    else:
        payer = next((n for n in everyone if n.lower() == payer_arg.lower()), None)
        if not payer:
            return _ask(
                f"'{payer_arg}' isn't in this split. Ask who paid.",
                options=everyone[:4],
            )

    tab = _target_tab(db, user_id, my_name, people, args.get("group"))
    if tab["status"] != "ok":
        return tab
    group: Optional[SplitGroup] = tab["data"]["group"]
    if group is not None:
        member_names = {m.name for m in group.members if m.deleted_at is None}
        if payer == my_name:
            mine = next(
                (m.name for m in group.members if m.user_id == user_id), my_name
            )
            payer = mine
            everyone = [mine] + [n for n, _ in people]
        if (
            db.query(ReceiptSplit)
            .filter(
                ReceiptSplit.group_id == group.id,
                ReceiptSplit.receipt_id == receipt.id,
                ReceiptSplit.deleted_at.is_(None),
            )
            .first()
        ):
            return _ask(
                f"This receipt is already split on {group.name}. Tell the person and ask "
                "whether they'd like to open that tab to change it."
            )
        missing = [n for n in everyone if n not in member_names]
        if missing and group.kind != "direct":
            return _ask(f"{', '.join(missing)} isn't on {group.name}.")
        everyone = [n for n in everyone if n in member_names] or everyone

    tax_mode = args.get("tax_mode") or "pro_rata"
    if tax_mode not in ("pro_rata", "even", "payer"):
        tax_mode = "pro_rata"
    if chosen:
        me_name = everyone[0]
        assignments = {name: [] for name in everyone}
        for li in lines:
            owners = everyone if li.id in item_ids else [me_name]
            for owner in owners:
                assignments[owner].append(li.id)
        shares = split_service.calculate_itemized_split(
            assignments,
            lines,
            receipt.tax or 0,
            payer,
            total=receipt.total,
            tax_mode=tax_mode,
        )
        mode = "itemized"
    else:
        assignments = None
        shares = split_service.calculate_even_shares(
            receipt.total, everyone, paid_by=payer
        )
        mode = "even"

    currency = receipt.currency or "USD"
    if chosen:
        names = [_line_name(li) for li in chosen]
        what = names[0] if len(names) == 1 else f"{names[0]} and {len(names) - 1} more"
        what += f" ({_money(sum(li.total_price or 0 for li in chosen), currency)})"
    else:
        what = f"your {receipt.merchant or 'receipt'} total ({_money(receipt.total, currency)})"
    owes = [
        f"{n} owes {'you' if payer == everyone[0] else payer} {_money(shares.get(n, 0), currency)}"
        for n in everyone
        if n != payer
    ]
    tab_name = group.name if group is not None else tab["data"]["name"]
    summary = (
        f"Split {what} with {', '.join(n for n, _ in people)}. "
        f"{'; '.join(owes)}. {receipt.merchant or 'Receipt'}, {_day(receipt.purchased_at)}, "
        f"on {tab_name}."
    )
    return _ok(
        {
            "summary": summary,
            "plan": {
                "receipt_id": receipt.id,
                "people": [[n, e] for n, e in people],
                "group_id": group.id if group is not None else None,
                "paid_by": payer,
                "mode": mode,
                "tax_mode": tax_mode,
                "item_ids": [li.id for li in chosen],
            },
            "shares": shares,
            "tab": tab_name,
        }
    )


def split_purchase(db: Session, user_id: str, **plan: Any) -> Dict[str, Any]:
    """Carry out a split prepared by `prepare_split` (after the person confirmed)."""
    user, my_name = _me(db, user_id)
    receipt = (
        db.query(Receipt)
        .filter(Receipt.id == plan.get("receipt_id"), Receipt.user_id == user_id)
        .first()
    )
    if not receipt or receipt.deleted_at is not None:
        return _err("That receipt is gone.")
    people = [(n, e) for n, e in plan.get("people") or []]
    if plan.get("group_id"):
        group = db.get(SplitGroup, plan["group_id"])
        if group is None or group.deleted_at is not None:
            return _err("That tab is gone.")
    else:
        group = split_service.direct_tab(db, user_id, my_name, people)
    members = {m.name: m for m in group.members if m.deleted_at is None}
    me_member = next((m for m in members.values() if m.user_id == user_id), None)
    payer_name = plan.get("paid_by") or my_name
    if payer_name == my_name and me_member is not None:
        payer_name = me_member.name
    if payer_name not in members:
        return _err("Who paid isn't on that tab.")
    if (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.group_id == group.id,
            ReceiptSplit.receipt_id == receipt.id,
            ReceiptSplit.deleted_at.is_(None),
        )
        .first()
    ):
        return _err("This receipt is already split on that tab.")
    everyone = [me_member.name if me_member else my_name] + [n for n, _ in people]
    everyone = [n for n in everyone if n in members]
    lines = [
        li
        for li in receipt.line_items
        if li.deleted_at is None and (li.total_price or 0) > 0
    ]
    item_ids = set(plan.get("item_ids") or [])
    tax_mode = plan.get("tax_mode") or "pro_rata"
    if item_ids:
        assignments = {members[n].id: [] for n in everyone}
        for li in lines:
            owners = everyone if li.id in item_ids else [everyone[0]]
            for owner in owners:
                assignments[members[owner].id].append(li.id)
        shares = split_service.calculate_itemized_split(
            assignments,
            lines,
            receipt.tax or 0,
            members[payer_name].id,
            total=receipt.total,
            tax_mode=tax_mode,
        )
        mode = "itemized"
    else:
        assignments = None
        shares = split_service.calculate_even_shares(
            receipt.total,
            [members[n].id for n in everyone],
            paid_by=members[payer_name].id,
        )
        mode = "even"
    split = split_service.create_split(
        db,
        group.id,
        receipt.id,
        members[payer_name].id,
        shares,
        mode=mode,
        tax_mode=tax_mode,
        assignments=assignments,
    )
    by_name = {m.id: n for n, m in members.items()}
    return _ok(
        {
            "split_id": split.id,
            "group_id": group.id,
            "tab": group.name,
            "shares": {by_name[k]: v for k, v in shares.items()},
            "open": f"/app/groups/{group.id}",
        }
    )


# --- settle_up --------------------------------------------------------------


def prepare_settle(db: Session, user_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Find what's owed between this person and someone, and on which tab."""
    who = (args.get("person") or "").strip()
    if not who:
        return _ask("Ask who paid.")
    resolved = _resolve_people(db, user_id, [who])
    if resolved["status"] != "ok":
        return resolved
    name = resolved["data"][0][0]
    rows = []
    for group in split_service.groups_for_user(db, user_id):
        me = next(
            (m for m in group.members if m.user_id == user_id and m.deleted_at is None),
            None,
        )
        them = next(
            (
                m
                for m in group.members
                if m.deleted_at is None and m.name.strip().lower() == name.lower()
            ),
            None,
        )
        if not me or not them:
            continue
        for t in split_service.simplify_debts(db, group.id):
            # Transfers name members by id.
            if {t["from"], t["to"]} == {me.id, them.id} and t["amount"] > 0:
                rows.append((group, me, them, t))
    if not rows:
        return _ask(
            f"You and {name} are already even. Tell the person; nothing to record."
        )
    tab_arg = (args.get("group") or "").strip().lower()
    if tab_arg:
        rows = [r for r in rows if tab_arg in r[0].name.lower()] or rows
    if len(rows) > 1:
        return _ask(
            f"You and {name} have balances on more than one tab. Ask which one.",
            options=[f"{g.name}: {_money(t['amount'])}" for g, _, _, t in rows][:4],
        )
    group, me, them, t = rows[0]
    they_pay = t["from"] == them.id
    owed = round(float(t["amount"]), 2)
    amount = args.get("amount")
    try:
        amount = round(float(amount), 2) if amount not in (None, "") else owed
    except (TypeError, ValueError):
        amount = owed
    if not 0 < amount <= owed + 0.005:
        return _ask(
            f"The balance is {_money(owed)}. Ask the person to confirm the amount "
            "(it can't be more than what's owed)."
        )
    method = (args.get("method") or "other").lower()
    if method not in ("venmo", "paypal", "cashapp", "zelle", "cash", "other"):
        method = "other"
    who_paid = f"{them.name} paid you" if they_pay else f"You paid {them.name}"
    rest = owed - amount
    summary = f"Record that {who_paid} {_money(amount)} on {group.name}." + (
        f" {_money(rest)} will still be owed." if rest >= 0.01 else " That settles it."
    )
    return _ok(
        {
            "summary": summary,
            "plan": {
                "group_id": group.id,
                "from_member_id": them.id if they_pay else me.id,
                "to_member_id": me.id if they_pay else them.id,
                "amount": amount,
                "method": method,
            },
        }
    )


def settle_up(db: Session, user_id: str, **plan: Any) -> Dict[str, Any]:
    group = db.get(SplitGroup, plan.get("group_id"))
    if group is None or group.deleted_at is not None:
        return _err("That tab is gone.")
    if group.id not in {g.id for g in split_service.groups_for_user(db, user_id)}:
        return _err("That tab isn't yours.")
    payment = Settlement(
        group_id=group.id,
        from_member_id=plan["from_member_id"],
        to_member_id=plan["to_member_id"],
        amount=round(float(plan["amount"]), 2),
        method=plan.get("method") or "other",
        recorded_by=user_id,
    )
    db.add(payment)
    db.commit()
    return _ok(
        {"group_id": group.id, "tab": group.name, "open": f"/app/groups/{group.id}"}
    )


# Actions Tabby proposes: name -> (prepare, execute).
ACTIONS = {
    "split_purchase": (prepare_split, split_purchase),
    "settle_up": (prepare_settle, settle_up),
}
