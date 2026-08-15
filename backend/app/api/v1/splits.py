import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.split_schemas import (
    GroupCreate,
    GroupOut,
    GroupSummary,
    SplitCreate,
    SplitOut,
)
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    SplitGroup,
    SplitItemAssignment,
    SplitMember,
    User,
)
from app.services.split_service import (
    calculate_even_shares,
    calculate_itemized_split,
    create_split,
    group_summary,
    owner_net_balances,
)

router = APIRouter(prefix="/splits", tags=["splits"])


@router.post("/groups", response_model=GroupOut)
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = SplitGroup(
        owner_id=user.id, name=body.name.strip() or "Split", share_code=uuid.uuid4().hex
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    me = SplitMember(group_id=group.id, name=body.my_name, user_id=user.id)
    db.add(me)
    seen = {body.my_name.strip().lower()}
    for member in body.members:
        name = member if isinstance(member, str) else member.name
        email = None if isinstance(member, str) else member.email
        name = name.strip()
        key = (email or name).strip().lower()
        if name and key not in seen:
            db.add(SplitMember(group_id=group.id, name=name, email=email))
            seen.add(key)
    db.commit()

    return GroupOut(
        id=group.id,
        name=group.name,
        share_code=group.share_code,
        share_url=f"/share/{group.share_code}",
        members=[{"id": m.id, "name": m.name, "email": m.email} for m in group.members],
    )


@router.get("/groups", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = (
        db.query(SplitGroup)
        .filter(SplitGroup.owner_id == user.id, SplitGroup.deleted_at.is_(None))
        .all()
    )
    return [
        GroupOut(
            id=g.id,
            name=g.name,
            share_code=g.share_code,
            share_url=f"/share/{g.share_code}",
            members=[
                {"id": m.id, "name": m.name, "email": m.email}
                for m in g.members
                if m.deleted_at is None
            ],
        )
        for g in groups
    ]


@router.post("/groups/{group_id}/splits", response_model=SplitOut)
def add_split(
    group_id: str,
    body: SplitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = (
        db.query(SplitGroup)
        .filter(SplitGroup.id == group_id, SplitGroup.owner_id == user.id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    receipt = (
        db.query(Receipt)
        .filter(
            Receipt.id == body.receipt_id,
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    members = {m.name: m for m in group.members}
    if body.paid_by not in members:
        raise HTTPException(
            status_code=400, detail="paid_by must be a group member name"
        )

    if body.mode == "even":
        assignments_by_id = None
        shares = calculate_even_shares(receipt.total, [m.id for m in members.values()])
    else:
        if body.assignments is None:
            raise HTTPException(
                status_code=400, detail="assignments required for itemized mode"
            )
        id_map = {name: m.id for name, m in members.items()}
        assignments_by_id = {
            id_map[name]: item_ids
            for name, item_ids in body.assignments.items()
            if name in id_map
        }
        items = (
            db.query(ReceiptLineItem)
            .filter(ReceiptLineItem.receipt_id == receipt.id)
            .all()
        )
        valid_item_ids = {item.id for item in items}
        assignments_by_id = {
            member_id: [item_id for item_id in item_ids if item_id in valid_item_ids]
            for member_id, item_ids in assignments_by_id.items()
        }
        shares = calculate_itemized_split(
            assignments_by_id,
            items,
            receipt.tax or 0,
            id_map[body.paid_by],
            total=receipt.total,
            tax_mode=body.tax_mode,
        )

    if (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.group_id == group.id,
            ReceiptSplit.receipt_id == receipt.id,
            ReceiptSplit.deleted_at.is_(None),
        )
        .first()
    ):
        raise HTTPException(
            status_code=409, detail="This receipt is already in the group"
        )
    split = create_split(
        db,
        group.id,
        receipt.id,
        members[body.paid_by].id,
        shares,
        mode=body.mode,
        tax_mode=body.tax_mode,
        assignments=assignments_by_id,
    )
    id_to_name = {m.id: name for name, m in members.items()}
    return SplitOut(
        split_id=split.id,
        shares={id_to_name[mid]: amt for mid, amt in shares.items()},
    )


@router.get("/groups/{group_id}/summary", response_model=GroupSummary)
def get_summary(
    group_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    group = (
        db.query(SplitGroup)
        .filter(SplitGroup.id == group_id, SplitGroup.owner_id == user.id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group_summary(db, group_id)


@router.get("/suggestions/{receipt_id}")
def suggestions(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Prior people plus explainable same-merchant item assignment patterns."""
    receipt = (
        db.query(Receipt)
        .filter(
            Receipt.id == receipt_id,
            Receipt.user_id == user.id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    groups = (
        db.query(SplitGroup)
        .filter(SplitGroup.owner_id == user.id, SplitGroup.deleted_at.is_(None))
        .all()
    )
    contacts, merchant_history_count, merchant_contacts, pattern = (
        {},
        0,
        set(),
        defaultdict(list),
    )
    for group in groups:
        for member in group.members:
            if member.user_id != user.id and member.deleted_at is None:
                key = (member.email or member.name).strip().lower()
                row = contacts.setdefault(
                    key, {"name": member.name, "email": member.email, "split_count": 0}
                )
                row["split_count"] += 1
        for old_split in (
            db.query(ReceiptSplit)
            .filter(
                ReceiptSplit.group_id == group.id, ReceiptSplit.deleted_at.is_(None)
            )
            .all()
        ):
            old_receipt = (
                db.query(Receipt).filter(Receipt.id == old_split.receipt_id).first()
            )
            if (
                not old_receipt
                or (old_receipt.merchant or "").strip().lower()
                != (receipt.merchant or "").strip().lower()
            ):
                continue
            merchant_history_count += 1
            merchant_contacts.update(
                (member.email or member.name).strip().lower()
                for member in group.members
                if member.user_id != user.id and member.deleted_at is None
            )
            member_names = {m.id: m.name for m in group.members}
            for assignment in (
                db.query(SplitItemAssignment)
                .filter(
                    SplitItemAssignment.split_id == old_split.id,
                    SplitItemAssignment.deleted_at.is_(None),
                )
                .all()
            ):
                item = (
                    db.query(ReceiptLineItem)
                    .filter(ReceiptLineItem.id == assignment.line_item_id)
                    .first()
                )
                if item:
                    pattern[item.description.strip().lower()].append(
                        member_names.get(assignment.member_id, "")
                    )
    assignments = {}
    for item in receipt.line_items:
        names = [
            name for name in pattern.get(item.description.strip().lower(), []) if name
        ]
        if names:
            assignments[item.id] = sorted(set(names))
    count = merchant_history_count
    people = sorted(
        contacts.values(), key=lambda row: (-row["split_count"], row["name"].lower())
    )
    suggested_people = [
        contact for key, contact in contacts.items() if key in merchant_contacts
    ]
    suggested_people.sort(key=lambda row: (-row["split_count"], row["name"].lower()))
    return {
        "contacts": people,
        "merchant": receipt.merchant,
        "merchant_history_count": count,
        "suggested_people": suggested_people,
        "assignments": assignments,
        "confidence": round(min(1, count / 3), 2),
        "auto_apply": count >= 3,
    }


@router.get("/net-balances")
def net_balances(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return owner_net_balances(db, user.id)


# Public share link (no auth) — friends view balances without an account
@router.get("/share/{share_code}")
def public_share(share_code: str, db: Session = Depends(get_db)):
    group = (
        db.query(SplitGroup)
        .filter(SplitGroup.share_code == share_code, SplitGroup.deleted_at.is_(None))
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Share link not found")
    summary = group_summary(db, group.id)
    # A share code exposes financial data by design, but never contact details.
    summary["members"] = [
        {"id": member["id"], "name": member["name"]} for member in summary["members"]
    ]
    return summary
