import uuid

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
    SplitMember,
    User,
)
from app.services.split_service import (
    calculate_even_split,
    calculate_itemized_split,
    create_split,
    group_summary,
)

router = APIRouter(prefix="/splits", tags=["splits"])


@router.post("/groups", response_model=GroupOut)
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = SplitGroup(
        owner_id=user.id, name=body.name, share_code=uuid.uuid4().hex[:10]
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    me = SplitMember(group_id=group.id, name=body.my_name, user_id=user.id)
    db.add(me)
    for name in body.members:
        db.add(SplitMember(group_id=group.id, name=name))
    db.commit()

    return GroupOut(
        id=group.id,
        name=group.name,
        share_code=group.share_code,
        share_url=f"/split/{group.share_code}",
        members=[m.name for m in group.members],
    )


@router.get("/groups", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = db.query(SplitGroup).filter(SplitGroup.owner_id == user.id).all()
    return [
        GroupOut(
            id=g.id,
            name=g.name,
            share_code=g.share_code,
            share_url=f"/split/{g.share_code}",
            members=[m.name for m in g.members],
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
        .filter(Receipt.id == body.receipt_id, Receipt.user_id == user.id)
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
        amt = calculate_even_split(receipt.total, len(members))
        shares = {m.id: amt for m in members.values()}
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
        shares = calculate_itemized_split(
            assignments_by_id, items, receipt.tax or 0, id_map[body.paid_by]
        )

    split = create_split(db, group.id, receipt.id, members[body.paid_by].id, shares)
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
    return group_summary(db, group.id)
