"""Cent-accurate split allocation, summaries, history and debt netting."""

from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    Settlement,
    SplitGroup,
    SplitItemAssignment,
    SplitMember,
    SplitShare,
    User,
)
from app.services import pay_links, price_memory
from app.utils.receipt_lines import is_charge


def _cents(value: float) -> int:
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), ROUND_HALF_UP))


def _money(cents: int) -> float:
    return float(Decimal(cents) / 100)


def _allocate(cents: int, weights: Dict[str, int]) -> Dict[str, int]:
    """Largest-remainder allocation: deterministic and exact to the cent.

    Ties go to whoever comes first in `weights`, so callers list the payer
    first and a preview by name lands the odd cent where the saved split does.
    """
    keys = list(weights)
    if not keys:
        return {}
    sign, remaining = (-1 if cents < 0 else 1), abs(cents)
    positive = {key: max(0, weights[key]) for key in keys}
    total = sum(positive.values())
    if total == 0:
        positive, total = {key: 1 for key in keys}, len(keys)
    raw = {key: Decimal(remaining) * positive[key] / total for key in keys}
    out = {key: int(raw[key]) for key in keys}
    left = remaining - sum(out.values())
    rank = {key: index for index, key in enumerate(keys)}
    order = sorted(keys, key=lambda key: (-(raw[key] - out[key]), rank[key]))
    for key in order[:left]:
        out[key] += 1
    return {key: sign * amount for key, amount in out.items()}


def calculate_even_split(total: float, n_members: int) -> float:
    """Compatibility helper for chat; REST uses exact per-member shares."""
    return round(total / max(n_members, 1), 2)


def calculate_even_shares(
    total: float, member_ids: List[str], paid_by: Optional[str] = None
) -> Dict[str, float]:
    ordered = list(
        dict.fromkeys(([paid_by] if paid_by in member_ids else []) + member_ids)
    )
    parts = _allocate(_cents(total), {member_id: 1 for member_id in ordered})
    return {member_id: _money(amount) for member_id, amount in parts.items()}


def calculate_itemized_split(
    assignments: Dict[str, List[str]],
    items: List[ReceiptLineItem],
    tax: float,
    paid_by_member_id: str,
    total: Optional[float] = None,
    tax_mode: str = "pro_rata",
) -> Dict[str, float]:
    """Allocate shared items, then reconcile tax/tip/discount to receipt total.

    An item assigned to several people is divided evenly. Unassigned items go
    to the payer, ensuring no cents disappear because of an incomplete form.
    Fee, tip, tax and discount lines aren't items anyone had: they're left
    out here and shared with the rest of the extra, per tax_mode.
    """
    charges, things = [], []
    for item in items:
        line = is_charge(getattr(item, "description", ""), item.total_price)
        (charges if line else things).append(item)
    items = things
    member_ids = list(dict.fromkeys([paid_by_member_id, *assignments]))
    rank = {member_id: index for index, member_id in enumerate(member_ids)}
    owners: Dict[str, List[str]] = defaultdict(list)
    for member_id, item_ids in assignments.items():
        for item_id in set(item_ids):
            owners[item_id].append(member_id)

    base = {member_id: 0 for member_id in member_ids}
    for item in items:
        item_owners = sorted(
            set(owners.get(item.id) or [paid_by_member_id]), key=rank.__getitem__
        )
        parts = _allocate(_cents(item.total_price), {owner: 1 for owner in item_owners})
        for member_id, amount in parts.items():
            base[member_id] = base.get(member_id, 0) + amount

    target = (
        _cents(total)
        if total is not None
        else sum(base.values())
        + sum(_cents(item.total_price) for item in charges)
        + _cents(tax)
    )
    extra = target - sum(base.values())
    if tax_mode == "payer":
        extras = {
            member_id: extra if member_id == paid_by_member_id else 0
            for member_id in base
        }
    elif tax_mode == "even":
        extras = _allocate(extra, {member_id: 1 for member_id in base})
    else:
        extras = _allocate(extra, base)
    return {
        member_id: _money(base[member_id] + extras.get(member_id, 0))
        for member_id in base
    }


def create_split(
    db: Session,
    group_id: str,
    receipt_id: str,
    paid_by_member_id: str,
    shares: Dict[str, float],
    mode: str = "even",
    tax_mode: str = "pro_rata",
    assignments: Optional[Dict[str, List[str]]] = None,
) -> ReceiptSplit:
    split = ReceiptSplit(
        group_id=group_id,
        receipt_id=receipt_id,
        paid_by_member_id=paid_by_member_id,
        mode=mode,
        tax_mode=tax_mode,
    )
    db.add(split)
    db.flush()
    for member_id, amount in shares.items():
        if member_id != paid_by_member_id:
            db.add(SplitShare(split_id=split.id, member_id=member_id, amount=amount))
    for member_id, item_ids in (assignments or {}).items():
        for item_id in set(item_ids):
            db.add(
                SplitItemAssignment(
                    split_id=split.id, line_item_id=item_id, member_id=member_id
                )
            )
    db.commit()
    db.refresh(split)
    return split


def _shares_of(
    db: Session, splits: List[ReceiptSplit], unsettled: bool = False
) -> Dict[str, List[SplitShare]]:
    """Each split's live shares, from one query (not one per split)."""
    by_split: Dict[str, List[SplitShare]] = {split.id: [] for split in splits}
    query = db.query(SplitShare).filter(
        SplitShare.split_id.in_(list(by_split)), SplitShare.deleted_at.is_(None)
    )
    if unsettled:
        query = query.filter(SplitShare.settled.is_(False))
    for share in query.order_by(SplitShare.created_at):
        by_split[share.split_id].append(share)
    return by_split


def group_balances(db: Session, group_id: str) -> Dict[str, float]:
    """Net position per member id: positive is owed money, negative owes.

    Unsettled split shares create debts; recorded settlements pay them down.
    """
    balances: Dict[str, float] = defaultdict(float)
    splits = (
        db.query(ReceiptSplit)
        .filter(ReceiptSplit.group_id == group_id, ReceiptSplit.deleted_at.is_(None))
        .all()
    )
    shares_of = _shares_of(db, splits, unsettled=True)
    for split in splits:
        for share in shares_of[split.id]:
            balances[split.paid_by_member_id] += share.amount
            balances[share.member_id] -= share.amount
    for payment in _settlements(db, group_id):
        balances[payment.from_member_id] += payment.amount
        balances[payment.to_member_id] -= payment.amount
    return dict(balances)


def _settlements(db: Session, group_id: str) -> List[Settlement]:
    return (
        db.query(Settlement)
        .filter(Settlement.group_id == group_id, Settlement.deleted_at.is_(None))
        .order_by(Settlement.created_at.desc())
        .all()
    )


def simplify_debts(db: Session, group_id: str) -> List[Dict]:
    """The fewest payments that leave everyone even (greedy largest-first)."""
    balances = group_balances(db, group_id)
    creditors = sorted(
        [(member, amount) for member, amount in balances.items() if amount > 0.005],
        key=lambda row: -row[1],
    )
    debtors = sorted(
        [(member, -amount) for member, amount in balances.items() if amount < -0.005],
        key=lambda row: -row[1],
    )
    transfers, debtor_i, creditor_i = [], 0, 0
    while debtor_i < len(debtors) and creditor_i < len(creditors):
        debtor, debt = debtors[debtor_i]
        creditor, credit = creditors[creditor_i]
        amount = round(min(debt, credit), 2)
        transfers.append({"from": debtor, "to": creditor, "amount": amount})
        debt, credit = debt - amount, credit - amount
        if debt < 0.005:
            debtor_i += 1
        else:
            debtors[debtor_i] = (debtor, debt)
        if credit < 0.005:
            creditor_i += 1
        else:
            creditors[creditor_i] = (creditor, credit)
    return transfers


def group_summary(db: Session, group_id: str, viewer_id: Optional[str] = None) -> Dict:
    group = db.query(SplitGroup).filter(SplitGroup.id == group_id).first()
    members = (
        db.query(SplitMember)
        .filter(SplitMember.group_id == group_id, SplitMember.deleted_at.is_(None))
        .all()
    )
    splits = (
        db.query(ReceiptSplit)
        .filter(ReceiptSplit.group_id == group_id, ReceiptSplit.deleted_at.is_(None))
        .all()
    )
    names = {member.id: member.name for member in members}
    shares_of = _shares_of(db, splits)
    receipts = {
        receipt.id: receipt
        for receipt in db.query(Receipt).filter(
            Receipt.id.in_([split.receipt_id for split in splits])
        )
    }
    detail, total = [], 0.0
    for split in splits:
        receipt = receipts.get(split.receipt_id)
        shares = shares_of[split.id]
        amount = receipt.total if receipt else sum(share.amount for share in shares)
        total += amount
        detail.append(
            {
                "split_id": split.id,
                "receipt_id": split.receipt_id,
                "merchant": receipt.merchant if receipt else "?",
                "purchased_at": (
                    receipt.purchased_at.isoformat()
                    if receipt and receipt.purchased_at
                    else None
                ),
                "currency": receipt.currency if receipt else "USD",
                "total": amount,
                "mode": split.mode,
                "tax_mode": split.tax_mode,
                "paid_by": names.get(split.paid_by_member_id, "?"),
                # The viewer added it, so they can change it.
                "mine": bool(viewer_id and receipt and receipt.user_id == viewer_id),
                "shares": [
                    {
                        "member": names.get(share.member_id, "?"),
                        "amount": share.amount,
                        "settled": share.settled,
                    }
                    for share in shares
                ],
            }
        )
    transfers = simplify_debts(db, group_id)
    currency = _group_currency(detail)
    title = group.name if group else "Split"
    by_id = {member.id: member for member in members}
    handles = {member.id: member_handles(db, member) for member in members}
    avatars = {member.id: member_avatar(db, member) for member in members}
    me = next((m for m in members if viewer_id and m.user_id == viewer_id), None)
    reminded = last_reminders(db, viewer_id) if viewer_id else {}
    return {
        "group_id": group_id,
        "group_name": title,
        "kind": (group.kind if group else None) or "group",
        "share_code": group.share_code if group else "",
        "currency": currency,
        "is_owner": bool(group and viewer_id and group.owner_id == viewer_id),
        "me": me.id if me else None,
        "members": [
            {
                "id": member.id,
                "name": member.name,
                "email": member.email,
                "joined": bool(member.user_id),
                "pay_methods": sorted(handles[member.id]),
                "own_handles": not member.user_id,
                "handles": handles[member.id] if not member.user_id else {},
                "avatar": avatars[member.id],
                "notify": _notifiable(db, member),
            }
            for member in members
        ],
        "member_count": len(members),
        "total_spend": round(total, 2),
        "splits": detail,
        "suggested_settlements": [
            {
                "from": names.get(row["from"], row["from"]),
                "to": names.get(row["to"], row["to"]),
                "from_id": row["from"],
                "to_id": row["to"],
                "amount": row["amount"],
                "last_reminded_at": (
                    reminded.get(row["from"]) if me and row["to"] == me.id else None
                ),
                "pay_links": (
                    pay_links.links(
                        handles.get(row["to"], {}),
                        row["amount"],
                        f"Cotab: {title}",
                        currency,
                    )
                    if row["to"] in by_id
                    else []
                ),
            }
            for row in transfers
        ],
        "settlements": [
            {
                "id": payment.id,
                "from": names.get(payment.from_member_id, "?"),
                "to": names.get(payment.to_member_id, "?"),
                "amount": payment.amount,
                "method": payment.method,
                "created_at": (
                    payment.created_at.isoformat() if payment.created_at else None
                ),
            }
            for payment in _settlements(db, group_id)
        ],
    }


def _notifiable(db: Session, member: SplitMember) -> bool:
    """Whether a push reminder can reach this person (they use Cotab and
    turned notifications on)."""
    if not member.user_id:
        return False
    from app.services import push_service

    return push_service.can_notify(db, member.user_id)


def last_reminders(db: Session, user_id: str) -> Dict[str, str]:
    """When this person last reminded each tab member (by member id)."""
    from app.models import ReminderLog

    out: Dict[str, str] = {}
    rows = (
        db.query(ReminderLog)
        .filter(
            ReminderLog.user_id == user_id,
            ReminderLog.kind.in_(["friend_reminder", "friend_message", "friend_push"]),
        )
        .order_by(ReminderLog.created_at.asc())
        .all()
    )
    for row in rows:
        when = row.created_at
        if when is not None and when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        out[row.period_key] = when.isoformat() if when else ""
    return out


def _group_currency(detail: List[Dict]) -> str:
    counts: Dict[str, int] = defaultdict(int)
    for row in detail:
        counts[row.get("currency") or "USD"] += 1
    return max(counts, key=lambda c: (counts[c], c == "USD")) if counts else "USD"


def member_handles(db: Session, member: SplitMember) -> Dict[str, str]:
    """A joined member is paid at their own account's handles; others at the group's."""
    if member.user_id:
        user = db.query(User).filter(User.id == member.user_id).first()
        return pay_links.load(user.pay_handles) if user else {}
    return pay_links.load(member.pay_handles)


def member_avatar(db: Session, member: SplitMember) -> Optional[Dict[str, str]]:
    """The Tabby a joined member picked for themselves, if any."""
    if not member.user_id:
        return None
    user = db.query(User).filter(User.id == member.user_id).first()
    if not user or not user.avatar_mood:
        return None
    return {
        "look": user.avatar_look or "hoodie",
        "mood": user.avatar_mood,
        "bg": user.avatar_bg or "mood",
    }


def groups_for_user(db: Session, user_id: str) -> List[SplitGroup]:
    """Groups this person owns or has joined."""
    joined = {
        row.group_id
        for row in db.query(SplitMember.group_id)
        .filter(SplitMember.user_id == user_id, SplitMember.deleted_at.is_(None))
        .all()
    }
    query = db.query(SplitGroup).filter(SplitGroup.deleted_at.is_(None))
    groups = query.filter(
        (SplitGroup.owner_id == user_id) | (SplitGroup.id.in_(list(joined) or [""]))
    ).all()
    return sorted(groups, key=lambda g: g.created_at or 0)


def _add_net(nets: Dict[str, Dict], other: Optional[SplitMember], delta: float) -> None:
    if not other:
        return
    key = (other.email or other.name).strip().lower()
    row = nets.setdefault(key, {"person": other.name, "email": other.email, "net": 0.0})
    row["net"] += delta


def owner_net_balances(db: Session, user_id: str) -> List[Dict]:
    """Your balance with each person, across every group you own or joined."""
    nets: Dict[str, Dict] = {}
    for group in groups_for_user(db, user_id):
        members = (
            db.query(SplitMember)
            .filter(SplitMember.group_id == group.id, SplitMember.deleted_at.is_(None))
            .all()
        )
        by_id = {member.id: member for member in members}
        me = next((member for member in members if member.user_id == user_id), None)
        if not me:
            continue
        splits = (
            db.query(ReceiptSplit)
            .filter(
                ReceiptSplit.group_id == group.id, ReceiptSplit.deleted_at.is_(None)
            )
            .all()
        )
        shares_of = _shares_of(db, splits, unsettled=True)
        for split in splits:
            for share in shares_of[split.id]:
                if split.paid_by_member_id == me.id:
                    other_id, delta = share.member_id, share.amount
                elif share.member_id == me.id:
                    other_id, delta = split.paid_by_member_id, -share.amount
                else:
                    continue
                _add_net(nets, by_id.get(other_id), delta)
        for payment in _settlements(db, group.id):
            if payment.from_member_id == me.id:
                _add_net(nets, by_id.get(payment.to_member_id), payment.amount)
            elif payment.to_member_id == me.id:
                _add_net(nets, by_id.get(payment.from_member_id), -payment.amount)
    result = []
    for row in nets.values():
        net = round(row["net"], 2)
        result.append(
            {
                **row,
                "net": net,
                "direction": (
                    "owes_you" if net > 0 else "you_owe" if net < 0 else "settled"
                ),
                "amount": abs(net),
            }
        )
    return sorted(result, key=lambda row: -row["amount"])


# --- friend ("direct") tabs -------------------------------------------------


def _person_key(name: str, email: Optional[str]) -> str:
    return (email or name or "").strip().lower()


def direct_tab_name(names: List[str]) -> str:
    if len(names) == 1:
        return f"You & {names[0]}"
    return "You, " + ", ".join(names[:-1]) + f" & {names[-1]}"


def clean_people(my_name: str, people: List[tuple]) -> List[tuple]:
    """(name, email) pairs, tidied, without the owner or repeats."""
    out, seen = [], {my_name.strip().lower()}
    for name, email in people:
        name = (name or "").strip()
        key = _person_key(name, email)
        if name and key not in seen:
            seen.add(key)
            out.append((name, (email or "").strip() or None))
    return out


def find_direct_tab(
    db: Session, owner_id: str, people: List[tuple]
) -> Optional[SplitGroup]:
    """The friend tab already holding exactly these people, if there is one."""
    wanted = {_person_key(n, e) for n, e in people}
    wanted_names = {n.strip().lower() for n, _ in people}
    groups = (
        db.query(SplitGroup)
        .filter(
            SplitGroup.owner_id == owner_id,
            SplitGroup.kind == "direct",
            SplitGroup.deleted_at.is_(None),
        )
        .all()
    )
    for group in groups:
        others = [
            m for m in group.members if m.deleted_at is None and m.user_id != owner_id
        ]
        if {_person_key(m.name, m.email) for m in others} == wanted or {
            m.name.strip().lower() for m in others
        } == wanted_names:
            return group
    return None


def direct_tab(
    db: Session, owner_id: str, my_name: str, people: List[tuple]
) -> SplitGroup:
    """The friend tab for these people: the same people always get the same
    tab, so the balance keeps one running total."""
    import uuid as _uuid

    group = find_direct_tab(db, owner_id, people)
    if group:
        return group
    group = SplitGroup(
        owner_id=owner_id,
        name=direct_tab_name([n for n, _ in people])[:255],
        share_code=_uuid.uuid4().hex,
        kind="direct",
    )
    db.add(group)
    db.flush()
    db.add(SplitMember(group_id=group.id, name=my_name.strip(), user_id=owner_id))
    for name, email in people:
        db.add(SplitMember(group_id=group.id, name=name, email=email))
    db.commit()
    db.refresh(group)
    return group


def reshare(
    db: Session, receipt: Receipt
) -> List[Tuple[ReceiptSplit, Dict[str, float]]]:
    """The receipt's total or items were corrected: work its splits out again
    with the same people and item picks. Returns each split whose shares
    changed, with everyone's new share."""
    db.flush()
    out = []
    for split in db.query(ReceiptSplit).filter(
        ReceiptSplit.receipt_id == receipt.id, ReceiptSplit.deleted_at.is_(None)
    ):
        rows = {
            row.member_id: row
            for row in db.query(SplitShare).filter(
                SplitShare.split_id == split.id, SplitShare.deleted_at.is_(None)
            )
        }
        if split.mode == "even":
            shares = calculate_even_shares(
                receipt.total or 0,
                [split.paid_by_member_id, *rows],
                paid_by=split.paid_by_member_id,
            )
        else:
            assignments: Dict[str, List[str]] = defaultdict(list)
            for row in db.query(SplitItemAssignment).filter(
                SplitItemAssignment.split_id == split.id,
                SplitItemAssignment.deleted_at.is_(None),
            ):
                assignments[row.member_id].append(row.line_item_id)
            shares = calculate_itemized_split(
                assignments,
                db.query(ReceiptLineItem)
                .filter(ReceiptLineItem.receipt_id == receipt.id)
                .all(),
                receipt.tax or 0,
                split.paid_by_member_id,
                total=receipt.total,
                tax_mode=split.tax_mode,
            )
        changed = False
        for member_id, row in rows.items():
            amount = shares.get(member_id, 0.0)
            changed |= row.amount != amount
            row.amount = amount
        for member_id, amount in shares.items():
            if member_id not in rows and member_id != split.paid_by_member_id:
                changed = True
                db.add(
                    SplitShare(split_id=split.id, member_id=member_id, amount=amount)
                )
        if changed:
            out.append((split, shares))
    return out


def same_item(line: ReceiptLineItem) -> str:
    """What makes two readings of a receipt line the same item."""
    return line.item_key or price_memory.item_key(
        line.item_code, line.description or line.item_name or ""
    )


def replace_lines(
    db: Session, receipt: Receipt, user_id: str, lines: list
) -> List[Tuple[ReceiptSplit, Dict[str, float]]]:
    """Swap a receipt's items for a new reading (scanned again, or the emailed
    copy of a tapped purchase). Who had each item on a split moves to the new
    item that reads the same; then its splits are worked out again (reshare)."""
    old = (
        db.query(ReceiptLineItem).filter(ReceiptLineItem.receipt_id == receipt.id).all()
    )
    new = [price_memory.make_line(receipt.id, user_id, li) for li in lines]
    db.add_all(new)
    db.flush()
    unclaimed: Dict[str, deque] = defaultdict(deque)
    for line in new:
        unclaimed[same_item(line)].append(line.id)
    moved = {
        line.id: unclaimed[same_item(line)].popleft()
        for line in old
        if unclaimed[same_item(line)]
    }
    picks = db.query(SplitItemAssignment).filter(
        SplitItemAssignment.line_item_id.in_([line.id for line in old])
    )
    for pick in picks:
        if pick.line_item_id in moved:
            pick.line_item_id = moved[pick.line_item_id]
        else:
            db.delete(pick)
    db.flush()
    for line in old:
        db.delete(line)
    return reshare(db, receipt)


def remove_receipt_splits(db: Session, receipt: Receipt) -> List[ReceiptSplit]:
    """A receipt is being deleted: take it off every tab it's on (Tabby's
    delete does the same in tabby_receipt_actions)."""
    splits = (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.receipt_id == receipt.id, ReceiptSplit.deleted_at.is_(None)
        )
        .all()
    )
    for split in splits:
        remove_split(db, split)
    return splits


def remove_split(db: Session, split: ReceiptSplit) -> None:
    """Take a split off its tab (soft delete, so it can be put back)."""
    now = datetime.now(timezone.utc)
    split.deleted_at = now
    for share in db.query(SplitShare).filter(
        SplitShare.split_id == split.id, SplitShare.deleted_at.is_(None)
    ):
        share.deleted_at = now
    for row in db.query(SplitItemAssignment).filter(
        SplitItemAssignment.split_id == split.id,
        SplitItemAssignment.deleted_at.is_(None),
    ):
        row.deleted_at = now


def restore_split(db: Session, split: ReceiptSplit) -> None:
    """Put back a split removed by `remove_split` (same moment, same rows)."""
    when = split.deleted_at
    split.deleted_at = None
    if when is None:
        return
    for share in db.query(SplitShare).filter(SplitShare.split_id == split.id):
        if _same_moment(share.deleted_at, when):
            share.deleted_at = None
    for row in db.query(SplitItemAssignment).filter(
        SplitItemAssignment.split_id == split.id
    ):
        if _same_moment(row.deleted_at, when):
            row.deleted_at = None


def _same_moment(a: Optional[datetime], b: Optional[datetime]) -> bool:
    if a is None or b is None:
        return False
    a = a if a.tzinfo else a.replace(tzinfo=timezone.utc)
    b = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
    return abs((a - b).total_seconds()) < 2


def remove_group_if_empty(db: Session, group_id: str) -> bool:
    """Drop a tab that has nothing on it any more (used when undoing the split
    that created it)."""
    group = db.get(SplitGroup, group_id)
    if group is None or group.deleted_at is not None:
        return False
    db.flush()
    live = (
        db.query(ReceiptSplit)
        .filter(ReceiptSplit.group_id == group_id, ReceiptSplit.deleted_at.is_(None))
        .count()
    )
    if live or _settlements(db, group_id):
        return False
    group.deleted_at = datetime.now(timezone.utc)
    return True
