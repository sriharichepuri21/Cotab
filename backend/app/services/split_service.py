"""Cent-accurate split allocation, summaries, history and debt netting."""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    SplitGroup,
    SplitItemAssignment,
    SplitMember,
    SplitShare,
)


def _cents(value: float) -> int:
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), ROUND_HALF_UP))


def _money(cents: int) -> float:
    return float(Decimal(cents) / 100)


def _allocate(cents: int, weights: Dict[str, int]) -> Dict[str, int]:
    """Largest-remainder allocation: deterministic and exact to the cent."""
    keys = sorted(weights)
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
    order = sorted(keys, key=lambda key: (-(raw[key] - out[key]), key))
    for key in order[:left]:
        out[key] += 1
    return {key: sign * amount for key, amount in out.items()}


def calculate_even_split(total: float, n_members: int) -> float:
    """Compatibility helper for chat; REST uses exact per-member shares."""
    return round(total / max(n_members, 1), 2)


def calculate_even_shares(total: float, member_ids: List[str]) -> Dict[str, float]:
    parts = _allocate(_cents(total), {member_id: 1 for member_id in member_ids})
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
    """
    member_ids = sorted(set(assignments) | {paid_by_member_id})
    owners: Dict[str, List[str]] = defaultdict(list)
    for member_id, item_ids in assignments.items():
        for item_id in set(item_ids):
            owners[item_id].append(member_id)

    base = {member_id: 0 for member_id in member_ids}
    for item in items:
        item_owners = sorted(set(owners.get(item.id) or [paid_by_member_id]))
        parts = _allocate(_cents(item.total_price), {owner: 1 for owner in item_owners})
        for member_id, amount in parts.items():
            base[member_id] = base.get(member_id, 0) + amount

    target = _cents(total) if total is not None else sum(base.values()) + _cents(tax)
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


def simplify_debts(db: Session, group_id: str) -> List[Dict]:
    splits = (
        db.query(ReceiptSplit)
        .filter(ReceiptSplit.group_id == group_id, ReceiptSplit.deleted_at.is_(None))
        .all()
    )
    balances: Dict[str, float] = {}
    for split in splits:
        shares = (
            db.query(SplitShare)
            .filter(
                SplitShare.split_id == split.id,
                SplitShare.settled.is_(False),
                SplitShare.deleted_at.is_(None),
            )
            .all()
        )
        for share in shares:
            balances[split.paid_by_member_id] = (
                balances.get(split.paid_by_member_id, 0) + share.amount
            )
            balances[share.member_id] = balances.get(share.member_id, 0) - share.amount
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


def group_summary(db: Session, group_id: str) -> Dict:
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
    detail, total = [], 0.0
    for split in splits:
        receipt = db.query(Receipt).filter(Receipt.id == split.receipt_id).first()
        shares = (
            db.query(SplitShare)
            .filter(SplitShare.split_id == split.id, SplitShare.deleted_at.is_(None))
            .all()
        )
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
    return {
        "group_id": group_id,
        "group_name": group.name if group else "Split",
        "share_code": group.share_code if group else "",
        "members": [
            {"id": member.id, "name": member.name, "email": member.email}
            for member in members
        ],
        "member_count": len(members),
        "total_spend": round(total, 2),
        "splits": detail,
        "suggested_settlements": [
            {
                "from": names.get(row["from"], row["from"]),
                "to": names.get(row["to"], row["to"]),
                "amount": row["amount"],
            }
            for row in transfers
        ],
    }


def owner_net_balances(db: Session, user_id: str) -> List[Dict]:
    """Owner-relative balances merged across groups by normalized email/name."""
    nets: Dict[str, Dict] = {}
    groups = (
        db.query(SplitGroup)
        .filter(SplitGroup.owner_id == user_id, SplitGroup.deleted_at.is_(None))
        .all()
    )
    for group in groups:
        members = (
            db.query(SplitMember)
            .filter(SplitMember.group_id == group.id, SplitMember.deleted_at.is_(None))
            .all()
        )
        by_id = {member.id: member for member in members}
        me = next((member for member in members if member.user_id == user_id), None)
        if not me:
            continue
        for split in (
            db.query(ReceiptSplit)
            .filter(
                ReceiptSplit.group_id == group.id, ReceiptSplit.deleted_at.is_(None)
            )
            .all()
        ):
            for share in (
                db.query(SplitShare)
                .filter(
                    SplitShare.split_id == split.id,
                    SplitShare.settled.is_(False),
                    SplitShare.deleted_at.is_(None),
                )
                .all()
            ):
                if split.paid_by_member_id == me.id:
                    other_id, delta = share.member_id, share.amount
                elif share.member_id == me.id:
                    other_id, delta = split.paid_by_member_id, -share.amount
                else:
                    continue
                other = by_id.get(other_id)
                if not other:
                    continue
                key = (other.email or other.name).strip().lower()
                row = nets.setdefault(
                    key, {"person": other.name, "email": other.email, "net": 0.0}
                )
                row["net"] += delta
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
