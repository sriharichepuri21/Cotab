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
    MemberName,
    MemberPhone,
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
from app.services import invites, notify, pay_links, push_service, split_service
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)
from app.services.split_service import (
    calculate_even_shares,
    calculate_itemized_split,
    create_split,
    group_summary,
    groups_for_user,
    owner_net_balances,
    simplify_debts,
)
from app.utils.phone import PhoneError, normalize_us_phone

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


def _group_out(db: Session, group: SplitGroup, user_id: str) -> GroupOut:
    members = _live_members(group)
    status = invites.statuses(members)
    owner = group.owner_id == user_id
    return GroupOut(
        id=group.id,
        name=group.name,
        share_code=group.share_code,
        share_url=f"/share/{group.share_code}",
        members=[
            {
                "id": m.id,
                "name": m.name,
                "email": m.email,
                "joined": bool(m.user_id),
                "status": status[m.id],
                # Only the owner sees the numbers they typed in for people.
                "phone": m.phone if owner and not m.user_id else None,
                "account": m.user_id,
            }
            for m in members
        ],
        is_owner=owner,
        kind=group.kind or "group",
    )


def _check_phone_rate(user: User) -> None:
    """Adding a number says whether it's on Cotab, so it's limited."""
    try:
        check_rate_limit("member-phone", user.id, 60, window_seconds=60 * 60)
    except (RateLimitExceeded, RateLimitUnavailable):
        raise HTTPException(
            status_code=429,
            detail="That's a lot of numbers. Try again in a little while.",
        )


def _link_people(db: Session, group: SplitGroup, user: User, people) -> None:
    """Match the people just put on a tab to who they are: someone picked
    from your list (`from_member`) becomes that exact person; otherwise the
    number (or email) typed in invites whoever signed up with it. Leaves
    people who already have a number, or have joined, alone."""
    wanted = {
        p.name.strip().lower(): p
        for p in people
        if (p.phone or "").strip()
        or getattr(p, "from_member", None)
        or (p.email or "").strip()
    }
    if not wanted:
        return
    _check_phone_rate(user)
    for member in _live_members(group):
        person = wanted.get(member.name.strip().lower())
        if not person or member.user_id or member.phone:
            continue
        try:
            if person.from_member:
                invites.copy_person(db, group, member, person.from_member, user)
            elif (person.phone or "").strip():
                invites.set_phone(db, group, member, person.phone, user.id)
            else:
                invites.set_email(db, group, member, person.email, user.id)
        except invites.InviteError as error:
            db.rollback()
            raise HTTPException(
                status_code=error.status, detail=f"{member.name}: {error}"
            )


def _same_name(name: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail=f"There's already a {name} in this split. "
        "Give this one a different name, like their last name.",
    )


def _distinct_people(db: Session, taken: list, people) -> list:
    """`people` checked for names: two different people (different numbers)
    can't share a name on a tab, since splits tell people apart by name, so
    that's refused for the person to rename. Blank names, and repeats with no
    number to tell them apart, are dropped as before."""
    used = {(t if isinstance(t, str) else t.name).strip().lower() for t in taken}
    out = []
    for person in people:
        name = person.name.strip()
        if not name:
            continue
        if name.lower() in used:
            if (
                (person.phone or "").strip()
                or person.from_member
                or (person.email or "").strip()
            ):
                raise _same_name(name)
            continue
        used.add(name.lower())
        out.append(person.model_copy(update={"name": name}))
    return out


def _check_phones(user: User, people) -> None:
    """Refuse bad numbers and emails (and your own) before anything is made."""
    for person in people:
        raw = getattr(person, "phone", None)
        email = getattr(person, "email", None)
        if email and email.strip():
            try:
                if invites.normalize_email(email) == user.email.lower():
                    raise HTTPException(
                        status_code=400,
                        detail=f"{person.name}: That's your own email.",
                    )
            except invites.InviteError as error:
                raise HTTPException(status_code=400, detail=f"{person.name}: {error}")
        if not raw or not raw.strip():
            continue
        try:
            phone = normalize_us_phone(raw)
        except PhoneError as error:
            raise HTTPException(status_code=400, detail=f"{person.name}: {error}")
        if phone == user.phone:
            raise HTTPException(
                status_code=400, detail=f"{person.name}: That's your own number."
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
    _check_phones(user, body.members)
    members = _distinct_people(db, [body.my_name], body.members)
    people = split_service.clean_people(
        body.my_name, [(m.name, m.email) for m in members]
    )
    if not people:
        raise HTTPException(status_code=400, detail="Add who you're splitting with.")
    group = split_service.direct_tab(db, user.id, body.my_name, people)
    before = invites.participants(group)
    _link_people(db, group, user, members)
    db.commit()
    notify.added(db, group, before, user.id)
    return _group_out(db, group, user.id)


@router.post("/groups", response_model=GroupOut)
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_phones(user, [m for m in body.members if not isinstance(m, str)])
    # In the order given, with a second, different Ben made "Ben (0177)".
    ordered: list = []
    for m in body.members:
        if isinstance(m, str):
            ordered.append(m)
            continue
        taken = [body.my_name] + [x if isinstance(x, str) else x.name for x in ordered]
        ordered.extend(_distinct_people(db, taken, [m]))
    typed = [m for m in ordered if not isinstance(m, str)]
    group = SplitGroup(
        owner_id=user.id, name=body.name.strip() or "Split", share_code=uuid.uuid4().hex
    )
    db.add(group)
    db.flush()

    me = SplitMember(group_id=group.id, name=body.my_name, user_id=user.id)
    db.add(me)
    seen = {body.my_name.strip().lower()}
    for member in ordered:
        name = member if isinstance(member, str) else member.name
        email = None if isinstance(member, str) else member.email
        name = name.strip()
        key = (email or name).strip().lower()
        if name and key not in seen:
            db.add(SplitMember(group_id=group.id, name=name, email=email))
            seen.add(key)
    db.flush()
    db.refresh(group)
    _link_people(db, group, user, typed)
    db.commit()
    notify.added(db, group, {user.id}, user.id)
    return _group_out(db, group, user.id)


@router.get("/groups", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [_group_out(db, g, user.id) for g in groups_for_user(db, user.id)]


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

    existing = (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.group_id == group.id,
            ReceiptSplit.receipt_id == receipt.id,
            ReceiptSplit.deleted_at.is_(None),
        )
        .first()
    )
    if existing and not body.replace:
        raise HTTPException(
            status_code=409, detail="This receipt is already in the group"
        )
    if existing:
        split_service.remove_split(db, existing)
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
    notify.split_added(
        db,
        group,
        user.id,
        receipt.merchant,
        receipt.total,
        shares,
        changed=bool(existing),
    )
    id_to_name = {m.id: name for name, m in members.items()}
    return SplitOut(
        split_id=split.id,
        shares={id_to_name[mid]: amt for mid, amt in shares.items()},
    )


@router.delete("/groups/{group_id}/splits/{split_id}")
def delete_split(
    group_id: str,
    split_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Take a purchase off the tab: whoever added it, or the tab's owner."""
    group = _group_for(db, group_id, user)
    split = (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.id == split_id,
            ReceiptSplit.group_id == group.id,
            ReceiptSplit.deleted_at.is_(None),
        )
        .first()
    )
    if not split:
        raise HTTPException(status_code=404, detail="Split not found")
    receipt = db.get(Receipt, split.receipt_id)
    if group.owner_id != user.id and (not receipt or receipt.user_id != user.id):
        raise HTTPException(
            status_code=403,
            detail="Only whoever added it, or the tab's owner, can remove it.",
        )
    split_service.remove_split(db, split)
    db.commit()
    notify.split_removed(db, group, user.id, receipt.merchant if receipt else "")
    return _for_viewer(db, group_summary(db, group.id, viewer_id=user.id))


@router.get("/groups/{group_id}/summary", response_model=GroupSummary)
def get_summary(
    group_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _group_for(db, group_id, user)
    return _for_viewer(db, group_summary(db, group_id, viewer_id=user.id))


def _for_viewer(db: Session, summary: dict) -> dict:
    """Each person's status (joined, not on Cotab...). Only the tab's owner sees
    the email addresses and phone numbers they typed in for people."""
    rows = {
        m.id: m
        for m in db.query(SplitMember).filter(
            SplitMember.id.in_([member["id"] for member in summary["members"]])
        )
    }
    status = invites.statuses(rows.values())
    for member in summary["members"]:
        row = rows.get(member["id"])
        member["status"] = status.get(member["id"], invites.NO_PHONE)
        member["account"] = row.user_id if row else None
        member["phone"] = (
            row.phone if row and summary["is_owner"] and not row.user_id else None
        )
        if not summary["is_owner"]:
            member["email"] = None
    # Who had which item, so Edit split starts from the same picks.
    names = {member_id: row.name for member_id, row in rows.items()}
    items: dict = {}
    for pick in db.query(SplitItemAssignment).filter(
        SplitItemAssignment.split_id.in_([s["split_id"] for s in summary["splits"]]),
        SplitItemAssignment.deleted_at.is_(None),
    ):
        if pick.member_id in names:
            mine = items.setdefault(pick.split_id, {})
            mine.setdefault(names[pick.member_id], []).append(pick.line_item_id)
    for split in summary["splits"]:
        split["items"] = items.get(split["split_id"], {})
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
    before = invites.participants(group)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Add a name")
    # A number is who someone is: the same number (or account) is the same
    # person whatever the name. Two different Bens can both be in, but not
    # both called "Ben": splits tell people apart by their name on the tab.
    identified = bool(
        (body.phone or "").strip() or body.from_member or (body.email or "").strip()
    )
    if identified:
        reason = invites.already_here(
            db, group, body.phone, body.from_member, body.email
        )
        if reason:
            raise HTTPException(status_code=409, detail=reason)
    if any(m.name.strip().lower() == name.lower() for m in _live_members(group)):
        if identified:
            raise _same_name(name)
        raise HTTPException(
            status_code=409,
            detail=f"{name} is already in this split. "
            "If this is someone else, add their number.",
        )
    member = SplitMember(group_id=group.id, name=name[:255], email=(body.email or None))
    db.add(member)
    if identified:
        _check_phone_rate(user)
        db.flush()
        try:
            if body.from_member:
                invites.copy_person(db, group, member, body.from_member, user)
            elif (body.phone or "").strip():
                invites.set_phone(db, group, member, body.phone, user.id)
            else:
                invites.set_email(db, group, member, body.email, user.id)
        except invites.InviteError as error:
            db.rollback()
            raise HTTPException(status_code=error.status, detail=str(error))
    db.commit()
    notify.added(db, group, before, user.id)
    return _group_out(db, group, user.id)


@router.put("/groups/{group_id}/members/{member_id}/phone", response_model=GroupOut)
def set_member_phone(
    group_id: str,
    member_id: str,
    body: MemberPhone,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add or change the number of someone on your tab (owner only)."""
    group = _group_for(db, group_id, user)
    before = invites.participants(group)
    if group.owner_id != user.id:
        raise HTTPException(
            status_code=403, detail="Only whoever started this tab can do that."
        )
    member = next((m for m in _live_members(group) if m.id == member_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Person not found")
    _check_phone_rate(user)
    try:
        invites.set_phone(db, group, member, body.phone, user.id)
    except invites.InviteError as error:
        db.rollback()
        raise HTTPException(status_code=error.status, detail=str(error))
    db.commit()
    notify.added(db, group, before, user.id)
    return _group_out(db, group, user.id)


@router.put("/groups/{group_id}/members/{member_id}/name", response_model=GroupOut)
def rename_member(
    group_id: str,
    member_id: str,
    body: MemberName,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change what someone is called on your tab (owner only), e.g. "Ben" to
    "Ben Carter" when another Ben joins. Who they are (their number or
    account) doesn't change."""
    group = _group_for(db, group_id, user)
    if group.owner_id != user.id:
        raise HTTPException(
            status_code=403, detail="Only whoever started this tab can do that."
        )
    member = next((m for m in _live_members(group) if m.id == member_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Person not found")
    name = body.name.strip()
    if any(
        m.id != member.id and m.name.strip().lower() == name.lower()
        for m in _live_members(group)
    ):
        raise HTTPException(
            status_code=409, detail=f"There's already a {name} in this split."
        )
    member.name = name
    db.commit()
    db.refresh(group)
    return _group_out(db, group, user.id)


@router.get("/people")
def my_people(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everyone you've split with, for the "Add someone" list. `ref` picks
    that exact person (send it as `from_member`)."""
    return invites.people_for(db, user)


@router.get("/lookup")
def lookup_contact(
    q: str = "",
    phone: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Who a mobile number or email is on Cotab (the name they signed up
    with), while you type it in to add them."""
    _check_phone_rate(user)
    try:
        return invites.lookup(db, user, q or phone)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


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
    notify.paid(db, group, payment, user.id)
    return _for_viewer(db, group_summary(db, group.id, viewer_id=user.id))


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
    return _for_viewer(db, group_summary(db, group.id, viewer_id=user.id))


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
    return _for_viewer(db, group_summary(db, group.id, viewer_id=user.id))


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
