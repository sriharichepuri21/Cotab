import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.split_schemas import (
    DirectCreate,
    GroupCreate,
    GroupOut,
    GroupSummary,
    JoinRequest,
    MemberAdd,
    PayHandles,
    ReminderCreate,
    SettlementCreate,
    SplitCreate,
    SplitOut,
    SplitPreview,
)
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import (
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    ReminderLog,
    Settlement,
    SplitGroup,
    SplitItemAssignment,
    SplitMember,
    User,
)
from app.services import pay_links, push_service, split_service
from app.services.split_service import (
    calculate_even_shares,
    calculate_itemized_split,
    create_split,
    group_summary,
    groups_for_user,
    owner_net_balances,
    simplify_debts,
)

router = APIRouter(prefix="/splits", tags=["splits"])


def _group_for(db: Session, group_id: str, user: User) -> SplitGroup:
    """A group this person owns or has joined, or 404."""
    group = (
        db.query(SplitGroup)
        .filter(SplitGroup.id == group_id, SplitGroup.deleted_at.is_(None))
        .first()
    )
    if group and group.owner_id != user.id:
        joined = any(
            m.user_id == user.id and m.deleted_at is None for m in group.members
        )
        if not joined:
            group = None
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _live_members(group: SplitGroup) -> list:
    return [m for m in group.members if m.deleted_at is None]


def _group_out(group: SplitGroup, user_id: str) -> GroupOut:
    return GroupOut(
        id=group.id,
        name=group.name,
        share_code=group.share_code,
        share_url=f"/share/{group.share_code}",
        members=[
            {"id": m.id, "name": m.name, "email": m.email, "joined": bool(m.user_id)}
            for m in _live_members(group)
        ],
        is_owner=group.owner_id == user_id,
        kind=group.kind or "group",
    )


@router.post("/direct", response_model=GroupOut)
def direct_split(
    body: DirectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The tab for splitting straight with these people.

    Splitting with Ben again lands on the same "You & Ben" tab, so what you
    owe each other keeps one running total instead of a new group every time.
    """
    people = split_service.clean_people(
        body.my_name, [(m.name, m.email) for m in body.members]
    )
    if not people:
        raise HTTPException(status_code=400, detail="Add who you're splitting with.")
    group = split_service.direct_tab(db, user.id, body.my_name, people)
    return _group_out(group, user.id)


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

    db.refresh(group)
    return _group_out(group, user.id)


@router.get("/groups", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [_group_out(g, user.id) for g in groups_for_user(db, user.id)]


@router.post("/groups/{group_id}/splits", response_model=SplitOut)
def add_split(
    group_id: str,
    body: SplitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _group_for(db, group_id, user)

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

    members = {m.name: m for m in _live_members(group)}
    if body.paid_by not in members:
        raise HTTPException(
            status_code=400, detail="paid_by must be a group member name"
        )

    if body.mode == "even":
        assignments_by_id = None
        shares = calculate_even_shares(
            receipt.total,
            [m.id for m in members.values()],
            paid_by=members[body.paid_by].id,
        )
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
    _group_for(db, group_id, user)
    return _for_viewer(group_summary(db, group_id, viewer_id=user.id))


def _for_viewer(summary: dict) -> dict:
    """Only the tab's owner sees the email addresses they typed in for people."""
    if not summary["is_owner"]:
        for member in summary["members"]:
            member["email"] = None
    return summary


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
    # A share code exposes financial data by design, but never contact details:
    # no emails, and no Zelle (an email or phone). Venmo, PayPal and Cash App
    # handles stay, since paying is the point of sending the link.
    summary["members"] = [
        {
            "id": member["id"],
            "name": member["name"],
            "joined": member["joined"],
            "pay_methods": [m for m in member["pay_methods"] if m != "zelle"],
            "avatar": member.get("avatar"),
        }
        for member in summary["members"]
    ]
    for row in summary["suggested_settlements"]:
        row["pay_links"] = [
            link for link in row["pay_links"] if link["method"] != "zelle"
        ]
    summary["is_owner"], summary["me"] = False, None
    return summary


@router.post("/groups/{group_id}/members", response_model=GroupOut)
def add_member(
    group_id: str,
    body: MemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _group_for(db, group_id, user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Add a name")
    if any(m.name.strip().lower() == name.lower() for m in _live_members(group)):
        raise HTTPException(status_code=409, detail=f"{name} is already on this tab")
    db.add(SplitMember(group_id=group.id, name=name[:255], email=(body.email or None)))
    db.commit()
    db.refresh(group)
    return _group_out(group, user.id)


@router.put("/groups/{group_id}/members/{member_id}/pay-handles")
def set_member_handles(
    group_id: str,
    member_id: str,
    body: PayHandles,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Where to pay a friend who doesn't have a Cotab account."""
    group = _group_for(db, group_id, user)
    member = next((m for m in _live_members(group) if m.id == member_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Person not found")
    if member.user_id:
        raise HTTPException(
            status_code=409,
            detail=f"{member.name} has joined, so they set their own payment details",
        )
    try:
        handles = pay_links.clean_handles(body.model_dump())
    except pay_links.HandleError as error:
        raise HTTPException(status_code=400, detail=str(error))
    member.pay_handles = pay_links.dump(handles)
    db.commit()
    return handles


@router.post("/groups/{group_id}/settlements")
def record_settlement(
    group_id: str,
    body: SettlementCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _group_for(db, group_id, user)
    ids = {m.id for m in _live_members(group)}
    if body.from_member_id not in ids or body.to_member_id not in ids:
        raise HTTPException(status_code=400, detail="Both people must be on this tab")
    if body.from_member_id == body.to_member_id:
        raise HTTPException(status_code=400, detail="Pick two different people")
    amount = round(body.amount, 2)
    if not 0 < amount <= 1_000_000:
        raise HTTPException(status_code=400, detail="Enter an amount above zero")
    payment = Settlement(
        group_id=group.id,
        from_member_id=body.from_member_id,
        to_member_id=body.to_member_id,
        amount=amount,
        method=body.method,
        recorded_by=user.id,
    )
    db.add(payment)
    db.commit()
    return _for_viewer(group_summary(db, group.id, viewer_id=user.id))


@router.post("/groups/{group_id}/remind")
def remind(
    group_id: str,
    body: ReminderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remind someone on this tab what they owe you: a notification on their
    phone that opens this tab, or you sent a message yourself and this notes
    when."""

    group = _group_for(db, group_id, user)
    members = {m.id: m for m in _live_members(group)}
    me = next((m for m in members.values() if m.user_id == user.id), None)
    them = members.get(body.member_id)
    if me is None or them is None:
        raise HTTPException(status_code=400, detail="They aren't on this tab")
    owed = next(
        (
            t["amount"]
            for t in simplify_debts(db, group.id)
            if t["from"] == them.id and t["to"] == me.id
        ),
        0,
    )
    if owed < 0.01:
        raise HTTPException(status_code=400, detail=f"{them.name} doesn't owe you here")
    if body.channel == "message":
        db.add(
            ReminderLog(
                user_id=user.id,
                kind="friend_message",
                period_key=them.id,
                channel="message",
            )
        )
        db.commit()
    else:
        if not push_service.can_notify(db, them.user_id):
            raise HTTPException(
                status_code=409,
                detail=f"{them.name} hasn't turned on Cotab notifications yet. "
                "Send a message instead.",
            )
        since = datetime.now(timezone.utc) - timedelta(hours=20)
        recent = (
            db.query(ReminderLog)
            .filter(
                ReminderLog.user_id == user.id,
                ReminderLog.kind == "friend_push",
                ReminderLog.period_key == them.id,
                ReminderLog.created_at >= since,
            )
            .first()
        )
        if recent is not None:
            raise HTTPException(
                status_code=409,
                detail=f"You already nudged {them.name} today. Try again tomorrow.",
            )
        where = f"your tab with {me.name}" if group.kind == "direct" else group.name
        delivered = push_service.send(
            db,
            them.user_id,
            f"Reminder from {me.name}",
            f"You owe {me.name} ${owed:,.2f} on {where}. Tap to see it and pay.",
            f"/app/groups/{group.id}",
        )
        if not delivered:
            raise HTTPException(
                status_code=409,
                detail=f"Couldn't reach {them.name}'s phone. Send a message instead.",
            )
        db.add(
            ReminderLog(
                user_id=user.id,
                kind="friend_push",
                period_key=them.id,
                channel="push",
            )
        )
        db.commit()
    return _for_viewer(group_summary(db, group.id, viewer_id=user.id))


@router.delete("/groups/{group_id}/settlements/{settlement_id}")
def undo_settlement(
    group_id: str,
    settlement_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _group_for(db, group_id, user)
    payment = (
        db.query(Settlement)
        .filter(
            Settlement.id == settlement_id,
            Settlement.group_id == group.id,
            Settlement.deleted_at.is_(None),
        )
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return _for_viewer(group_summary(db, group.id, viewer_id=user.id))


@router.post("/join/{share_code}")
def join_group(
    share_code: str,
    body: JoinRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Join a shared tab from its link, as one of its people or as someone new."""
    group = (
        db.query(SplitGroup)
        .filter(SplitGroup.share_code == share_code, SplitGroup.deleted_at.is_(None))
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Share link not found")
    members = _live_members(group)
    mine = next((m for m in members if m.user_id == user.id), None)
    if mine or group.owner_id == user.id:
        return {"group_id": group.id, "member_id": mine.id if mine else None}
    if body.member_id:
        mine = next((m for m in members if m.id == body.member_id), None)
        if not mine:
            raise HTTPException(status_code=404, detail="Person not found")
        if mine.user_id:
            raise HTTPException(
                status_code=409, detail=f"Someone has already joined as {mine.name}"
            )
        mine.user_id = user.id
        mine.pay_handles = None  # their own account's handles take over
    else:
        base = (user.full_name or user.email.split("@")[0]).strip() or "Friend"
        taken = {m.name.strip().lower() for m in members}
        name, n = base, 2
        while name.lower() in taken:
            name, n = f"{base} {n}", n + 1
        mine = SplitMember(
            group_id=group.id, name=name, email=user.email, user_id=user.id
        )
        db.add(mine)
    db.commit()
    return {"group_id": group.id, "member_id": mine.id}


@router.post("/preview")
def preview_split(
    body: SplitPreview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Each person's share before saving, so the split screen can show it live."""
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
    names = list(dict.fromkeys(n for n in body.members if n.strip()))
    if body.paid_by not in names:
        raise HTTPException(status_code=400, detail="paid_by must be one of members")
    if body.mode == "even":
        shares = calculate_even_shares(receipt.total, names, paid_by=body.paid_by)
    else:
        items = (
            db.query(ReceiptLineItem)
            .filter(ReceiptLineItem.receipt_id == receipt.id)
            .all()
        )
        valid = {item.id for item in items}
        assignments = {
            name: [i for i in (body.assignments or {}).get(name, []) if i in valid]
            for name in names
        }
        shares = calculate_itemized_split(
            assignments,
            items,
            receipt.tax or 0,
            body.paid_by,
            total=receipt.total,
            tax_mode=body.tax_mode,
        )
    items_total = round(sum(item.total_price or 0 for item in receipt.line_items), 2)
    return {
        "shares": {name: shares.get(name, 0.0) for name in names},
        "total": receipt.total,
        "items_total": items_total,
        "extra": round((receipt.total or 0) - items_total, 2),
        "currency": receipt.currency or "USD",
    }
