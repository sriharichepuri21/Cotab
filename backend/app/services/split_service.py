from typing import Dict, List

from sqlalchemy.orm import Session

from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    SplitGroup,
    SplitMember,
    SplitShare,
)


def calculate_even_split(total: float, n_members: int) -> float:
    return round(total / max(n_members, 1), 2)


def calculate_itemized_split(
    assignments: Dict[str, List[str]],  # member_id -> [line_item_id, ...]
    items: List[ReceiptLineItem],
    tax: float,
    paid_by_member_id: str,
) -> Dict[str, float]:
    """Per-person share = their items + pro-rata tax on their subtotal share."""
    item_map = {i.id: i for i in items}
    subtotals: Dict[str, float] = {}
    for mid, item_ids in assignments.items():
        subtotals[mid] = sum(
            item_map[iid].total_price for iid in item_ids if iid in item_map
        )

    total_sub = sum(subtotals.values()) or 1
    shares: Dict[str, float] = {}
    for mid, subtotal in subtotals.items():
        tax_share = tax * (subtotal / total_sub)
        shares[mid] = round(subtotal + tax_share, 2)
    return shares


def create_split(
    db: Session,
    group_id: str,
    receipt_id: str,
    paid_by_member_id: str,
    shares: Dict[str, float],
) -> ReceiptSplit:
    split = ReceiptSplit(
        group_id=group_id, receipt_id=receipt_id, paid_by_member_id=paid_by_member_id
    )
    db.add(split)
    db.commit()
    db.refresh(split)
    for member_id, amount in shares.items():
        if member_id == paid_by_member_id:
            continue
        db.add(SplitShare(split_id=split.id, member_id=member_id, amount=amount))
    db.commit()
    return split


def simplify_debts(db: Session, group_id: str) -> List[Dict]:
    """Greedy debtor/creditor netting: returns minimal transfer list."""
    splits = db.query(ReceiptSplit).filter(ReceiptSplit.group_id == group_id).all()
    balances: Dict[str, float] = {}
    for split in splits:
        shares = (
            db.query(SplitShare)
            .filter(SplitShare.split_id == split.id, SplitShare.settled.is_(False))
            .all()
        )
        for share in shares:
            balances[split.paid_by_member_id] = (
                balances.get(split.paid_by_member_id, 0) + share.amount
            )
            balances[share.member_id] = balances.get(share.member_id, 0) - share.amount

    creditors = sorted(
        [(mid, amt) for mid, amt in balances.items() if amt > 0.005],
        key=lambda x: -x[1],
    )
    debtors = sorted(
        [(mid, -amt) for mid, amt in balances.items() if amt < -0.005],
        key=lambda x: -x[1],
    )

    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        debtor, debt = debtors[i]
        creditor, credit = creditors[j]
        amount = round(min(debt, credit), 2)
        transfers.append({"from": debtor, "to": creditor, "amount": amount})
        debt -= amount
        credit -= amount
        if debt < 0.005:
            i += 1
        else:
            debtors[i] = (debtor, debt)
        if credit < 0.005:
            j += 1
        else:
            creditors[j] = (creditor, credit)
    return transfers


def group_summary(db: Session, group_id: str) -> Dict:
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
    member_names = {m.id: m.name for m in members}

    detail = []
    total = 0.0
    for split in splits:
        receipt = db.query(Receipt).filter(Receipt.id == split.receipt_id).first()
        shares = db.query(SplitShare).filter(SplitShare.split_id == split.id).all()
        amt_total = receipt.total if receipt else sum(s.amount for s in shares)
        total += amt_total
        detail.append(
            {
                "split_id": split.id,
                "receipt_id": split.receipt_id,
                "merchant": receipt.merchant if receipt else "?",
                "total": amt_total,
                "paid_by": member_names.get(split.paid_by_member_id, "?"),
                "shares": [
                    {
                        "member": member_names.get(s.member_id, "?"),
                        "amount": s.amount,
                        "settled": s.settled,
                    }
                    for s in shares
                ],
            }
        )

    transfers = simplify_debts(db, group_id)
    return {
        "group_id": group_id,
        "member_count": len(members),
        "total_spend": round(total, 2),
        "splits": detail,
        "suggested_settlements": [
            {
                "from": member_names.get(t["from"], t["from"]),
                "to": member_names.get(t["to"], t["to"]),
                "amount": t["amount"],
            }
            for t in transfers
        ],
    }
