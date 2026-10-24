"""What a purchase cost *you*: your share when it's split on a tab.

Budgets, Home, Insights and Tabby's spending answers all count spending
through here, so they agree:

- A receipt that isn't split counts in full for whoever owns it.
- A split receipt counts each person's share, whoever uploaded it and whoever
  paid: $60 dinner split three ways is $20 for you, and Ben's $40 gas split
  with you is $20 in your budget though it's his receipt.
- Settling up (a Settlement) moves money between friends; it is never
  spending, so nothing here reads settlements.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Callable, Dict, List, Optional

from sqlalchemy import select
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

# Statuses whose totals are real money (analytics_service.COUNTED_STATUSES).
COUNTED = ("extracted", "reviewed")


@dataclass
class Spend:
    receipt: Receipt
    amount: float  # what it cost this person
    split: Optional[ReceiptSplit] = None  # the split their share comes from
    member_id: Optional[str] = None  # them, on that split's tab


def _utc(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)


def _my_members(db: Session, user_id: str) -> Dict[str, str]:
    """Your member id on each live tab you're on, by tab id."""
    rows = (
        db.query(SplitMember.group_id, SplitMember.id)
        .join(SplitGroup, SplitGroup.id == SplitMember.group_id)
        .filter(
            SplitMember.user_id == user_id,
            SplitMember.deleted_at.is_(None),
            SplitGroup.deleted_at.is_(None),
        )
    )
    return {group_id: member_id for group_id, member_id in rows}


def _shares(
    db: Session, user_id: str, receipts: List[Receipt], mine: Dict[str, str]
) -> Dict[str, Spend]:
    """Your share of each receipt that's split on a tab you're on."""
    if not receipts or not mine:
        return {}
    by_id = {r.id: r for r in receipts}
    splits = (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.receipt_id.in_(list(by_id)),
            ReceiptSplit.group_id.in_(list(mine)),
            ReceiptSplit.deleted_at.is_(None),
        )
        .order_by(ReceiptSplit.created_at)
        .all()
    )
    rows: Dict[str, Dict[str, float]] = {s.id: {} for s in splits}
    for share in db.query(SplitShare).filter(
        SplitShare.split_id.in_(list(rows)), SplitShare.deleted_at.is_(None)
    ):
        rows[share.split_id][share.member_id] = share.amount
    out: Dict[str, Spend] = {}
    # shortcut: a receipt split on two of your tabs counts its newest split;
    # sum them if people start splitting one receipt across tabs.
    for split in splits:
        receipt, me, others = (
            by_id[split.receipt_id],
            mine[split.group_id],
            rows[split.id],
        )
        if me in others:
            amount = others[me]
        elif split.paid_by_member_id == me:
            amount = (receipt.total or 0.0) - sum(others.values())
        else:
            amount = 0.0
        out[receipt.id] = Spend(receipt, round(amount, 2), split, me)
    return out


def spending(
    db: Session,
    user_id: str,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> List[Spend]:
    """Every purchase in [start, end) that cost this person something, at
    their share: their own receipts, and friends' receipts split with them."""
    mine = _my_members(db, user_id)

    def window(query):
        query = query.filter(Receipt.deleted_at.is_(None), Receipt.status.in_(COUNTED))
        if start is not None:
            query = query.filter(Receipt.purchased_at >= _utc(start))
        if end is not None:
            query = query.filter(Receipt.purchased_at < _utc(end))
        return query

    receipts = {
        r.id: r for r in window(db.query(Receipt)).filter(Receipt.user_id == user_id)
    }
    if mine:
        on_my_tabs = select(ReceiptSplit.receipt_id).where(
            ReceiptSplit.group_id.in_(list(mine)), ReceiptSplit.deleted_at.is_(None)
        )
        for r in window(db.query(Receipt)).filter(
            Receipt.user_id != user_id, Receipt.id.in_(on_my_tabs)
        ):
            receipts[r.id] = r

    split = _shares(db, user_id, list(receipts.values()), mine)
    out = []
    for receipt in receipts.values():
        if receipt.id in split:
            out.append(split[receipt.id])
        elif receipt.user_id == user_id:
            out.append(Spend(receipt, round(receipt.total or 0.0, 2)))
    return out


def shares_of(db: Session, user_id: str, receipts: List[Receipt]) -> Dict[str, float]:
    """Your share of each of these receipts that's split ("$77.57 · yours
    $15.52"); receipts that aren't split aren't in the answer."""
    found = _shares(db, user_id, receipts, _my_members(db, user_id))
    return {receipt_id: spend.amount for receipt_id, spend in found.items()}


def item_spend(
    db: Session, spends: List[Spend], matches: Callable[[str], bool]
) -> float:
    """Your share of the line items that match, across these purchases.

    Split by item: an item you had alone is all yours, one shared by three is a
    third, one nobody picked is the payer's. Split evenly: your fraction of the
    receipt. Not split: all of it.
    """
    by_receipt = {s.receipt.id: s for s in spends}
    if not by_receipt:
        return 0.0
    lines = [
        line
        for line in db.query(ReceiptLineItem).filter(
            ReceiptLineItem.receipt_id.in_(list(by_receipt))
        )
        if matches(line.description or "")
    ]
    itemized = [s.split.id for s in spends if s.split and s.split.mode == "itemized"]
    owners: Dict[str, Dict[str, List[str]]] = {split_id: {} for split_id in itemized}
    for pick in db.query(SplitItemAssignment).filter(
        SplitItemAssignment.split_id.in_(itemized),
        SplitItemAssignment.deleted_at.is_(None),
    ):
        owners[pick.split_id].setdefault(pick.line_item_id, []).append(pick.member_id)

    total = 0.0
    for line in lines:
        spend, price = by_receipt[line.receipt_id], line.total_price or 0.0
        if spend.split is None:
            total += price
        elif spend.split.mode == "itemized":
            who = owners[spend.split.id].get(line.id) or [spend.split.paid_by_member_id]
            total += price / len(who) if spend.member_id in who else 0.0
        elif spend.receipt.total:
            total += price * spend.amount / spend.receipt.total
    return round(total, 2)
