"""Adding people to tabs by phone number or email.

Someone already on Cotab with that number or email is added to the tab
straight away: it shows up in their app. Anyone else stays on the tab under
the name you gave them, and when they sign up with that number or email
they're joined to it automatically (claim).

A number only links to an account once it's trusted (phone_trusted): proved
by a texted code, or any number while REQUIRE_PHONE_VERIFICATION is off.
Cotab has no SMS codes yet, so that setting stays off while it's private;
the code check calls phone_verified(), then the setting goes on.

Numbers are stored as "+14155550123" and only the tab's owner sees them. They
never go into share links or anything sent to the AI.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import SplitGroup, SplitMember, User
from app.utils.phone import normalize_us_phone

# What a person on a tab is, as far as Cotab knows:
JOINED = "joined"  # linked to their account
NOT_ON_COTAB = "not_on_cotab"  # nobody on Cotab has that number or email yet
NO_PHONE = "no_phone"  # added by name only


class InviteError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _live(members: Iterable[SplitMember]) -> List[SplitMember]:
    return [m for m in members if m.deleted_at is None]


def participants(group: SplitGroup) -> Set[str]:
    """Accounts on this tab: its owner and everyone who has joined."""
    return {group.owner_id} | {m.user_id for m in _live(group.members) if m.user_id}


def phone_trusted(user: User) -> bool:
    """Whether this person's number may link them to tabs and be found."""
    if not user.phone:
        return False
    return bool(user.phone_verified_at) or not get_settings().require_phone_verification


def account_for(db: Session, phone: Optional[str]) -> Optional[User]:
    """The account behind a number, if that number is trusted. Anyone else
    stays on a tab as not on Cotab, and joins once their number is proved."""
    if not phone:
        return None
    user = db.query(User).filter(User.phone == phone, User.deleted_at.is_(None)).first()
    return user if user and phone_trusted(user) else None


EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not EMAIL.match(email):
        raise InviteError("That email doesn't look right.")
    return email


def account_for_email(db: Session, email: Optional[str]) -> Optional[User]:
    if not email:
        return None
    return (
        db.query(User)
        .filter(func.lower(User.email) == email.lower(), User.deleted_at.is_(None))
        .first()
    )


def set_email(
    db: Session, group: SplitGroup, member: SplitMember, raw: str, added_by: str
) -> str:
    """Like set_phone, for someone added by email. Doesn't commit."""
    if member.user_id:
        raise InviteError(
            f"{member.name} has joined, so their email is their own.", 409
        )
    email = normalize_email(raw)
    clash = next(
        (
            m
            for m in _live(group.members)
            if (m.email or "").lower() == email and m.id != member.id
        ),
        None,
    )
    if clash:
        raise InviteError(f"That email is already in this split, as {clash.name}.", 409)
    account = account_for_email(db, email)
    if account and account.id == added_by:
        raise InviteError("That's your own email.")
    if account and account.id in participants(group):
        raise InviteError(f"{_name_on(group, account)} is already in this split.", 409)
    member.email = email
    return _link(member, account)


def set_phone(
    db: Session, group: SplitGroup, member: SplitMember, raw: str, added_by: str
) -> str:
    """Give someone on a tab a number: whoever signed up with it is added
    straight away. Returns their status. Doesn't commit."""
    if member.user_id:
        raise InviteError(
            f"{member.name} has joined, so their number is their own.", 409
        )
    try:
        phone = normalize_us_phone(raw)
    except ValueError as error:
        raise InviteError(str(error))
    clash = next(
        (m for m in _live(group.members) if m.phone == phone and m.id != member.id),
        None,
    )
    if clash:
        raise InviteError(
            f"That number is already in this split, as {clash.name}.", 409
        )
    me = db.get(User, added_by)
    if me and me.phone == phone:
        raise InviteError("That's your own number.")
    account = account_for(db, phone)
    if account and account.id in participants(group):
        raise InviteError(f"{_name_on(group, account)} is already in this split.", 409)
    member.phone = phone
    return _link(member, account)


def _link(member: SplitMember, account: Optional[User]) -> str:
    if not account:
        return NOT_ON_COTAB
    member.user_id = account.id
    member.pay_handles = None  # their own account's handles take over
    return JOINED


def _name_on(group: SplitGroup, account: User) -> str:
    """What this tab calls an account that's on it."""
    mine = next((m for m in _live(group.members) if m.user_id == account.id), None)
    return (mine.name if mine else "") or account.full_name or "That person"


def statuses(members: Iterable[SplitMember]) -> Dict[str, str]:
    """Each member's status by id."""
    return {
        m.id: (
            JOINED
            if m.user_id
            else NO_PHONE if not (m.phone or m.email) else NOT_ON_COTAB
        )
        for m in members
    }


def already_here(
    db: Session,
    group: SplitGroup,
    phone: Optional[str],
    ref: Optional[str],
    email: Optional[str] = None,
) -> Optional[str]:
    """Why this person (by number, email, or picked from your list) is
    already in the split, if they are. Checked before anything about names."""
    here = _live(group.members)
    if email and not phone and not ref:
        try:
            email = normalize_email(email)
        except InviteError:
            return None
        clash = next((m for m in here if (m.email or "").lower() == email), None)
        if clash:
            return f"That email is already in this split, as {clash.name}."
        account = account_for_email(db, email)
    elif phone:
        try:
            phone = normalize_us_phone(phone)
        except ValueError:
            return None
        clash = next((m for m in here if m.phone == phone), None)
        if clash:
            return f"That number is already in this split, as {clash.name}."
        account = account_for(db, phone)
    else:
        source = db.get(SplitMember, ref) if ref else None
        account = db.get(User, source.user_id) if source and source.user_id else None
        if not account and source and source.phone:
            clash = next((m for m in here if m.phone == source.phone), None)
            if clash:
                return f"{clash.name} is already in this split."
    if account and account.id in participants(group):
        return f"{_name_on(group, account)} is already in this split."
    return None


def claim(db: Session, user: User) -> List[SplitMember]:
    """Join this person to every tab someone put their number or email on
    before they signed up. Returns the places joined. Doesn't commit."""
    mine = [func.lower(SplitMember.email) == user.email.lower()]
    if phone_trusted(user):
        mine.append(SplitMember.phone == user.phone)
    waiting = (
        db.query(SplitMember)
        .join(SplitGroup, SplitGroup.id == SplitMember.group_id)
        .filter(
            or_(*mine),
            SplitMember.user_id.is_(None),
            SplitMember.deleted_at.is_(None),
            SplitGroup.deleted_at.is_(None),
            SplitGroup.owner_id != user.id,
        )
        .all()
    )
    joined = []
    for member in waiting:
        if user.id not in participants(member.group):  # one place per tab
            member.user_id = user.id
            member.pay_handles = None
            joined.append(member)
    return joined


def phone_verified(db: Session, user: User) -> List[SplitMember]:
    """A texted code proved this number is theirs: trust it and join every
    tab it was put on. The SMS check calls this. Doesn't commit."""
    user.phone_verified_at = datetime.now(timezone.utc)
    return claim(db, user)


# --- choosing people you already know ----------------------------------------


def _hint(phone: Optional[str]) -> Optional[str]:
    """Just enough of a number to tell two people apart: "•••0199"."""
    return f"\u2022\u2022\u2022{phone[-4:]}" if phone else None


def people_for(db: Session, user: User) -> List[Dict]:
    """The people this person has split with who are on Cotab, once each, for
    picking from a list: everyone on your tabs with an account. People added
    by name only, or by a number or email nobody uses yet, aren't listed.

    A number shows in full only where this person typed it in themselves (on
    tabs they own); otherwise the last four digits of the account's number,
    which tells two Bens apart without handing over the number. Strangers
    never appear: there's no searching Cotab by name.
    """
    from app.services.split_service import groups_for_user

    people: Dict[str, Dict] = {}
    for group in groups_for_user(db, user.id):
        mine = group.owner_id == user.id
        for m in _live(group.members):
            if not m.user_id or m.user_id == user.id:
                continue  # not on Cotab, or you
            row = people.setdefault(
                m.user_id,
                {
                    "ref": m.id,
                    # Two Bens with different numbers are two accounts.
                    "account": m.user_id,
                    "name": m.name,
                    "phone": None,
                    "hint": None,
                    "on_cotab": True,
                    "tabs": 0,
                },
            )
            row["tabs"] += 1
            if mine and m.phone and not row["phone"]:
                row["phone"] = m.phone
    accounts = {u.id: u for u in db.query(User).filter(User.id.in_(list(people)))}
    for account_id, row in people.items():
        account = accounts.get(account_id)
        if account and not row["phone"]:
            row["hint"] = _hint(account.phone)
    return sorted(people.values(), key=lambda r: (-r["tabs"], r["name"].lower()))


def copy_person(
    db: Session, group: SplitGroup, member: SplitMember, ref: str, user: User
) -> None:
    """Make `member` the same person as `ref`, someone on another tab this
    person is on: their account, or the number or email you gave them.
    Doesn't commit."""
    from app.services.split_service import groups_for_user

    source = db.get(SplitMember, ref)
    mine = {g.id: g for g in groups_for_user(db, user.id)}
    if not source or source.deleted_at or source.group_id not in mine:
        raise InviteError("That person isn't on any of your tabs.", 404)
    if source.user_id:
        if source.user_id == user.id:
            raise InviteError("That's you.")
        if source.user_id in participants(group):
            account = db.get(User, source.user_id)
            raise InviteError(
                f"{_name_on(group, account)} is already in this split.", 409
            )
        member.user_id = source.user_id
        member.pay_handles = None
        return
    if mine[source.group_id].owner_id == user.id:
        if source.phone:
            set_phone(db, group, member, source.phone, user.id)
        elif source.email:
            set_email(db, group, member, source.email, user.id)


def lookup(db: Session, user: User, raw: str) -> Dict:
    """Who is this number or email on Cotab: the name they signed up with,
    or nobody. Rate-limited by the caller."""
    if "@" in raw:
        email = normalize_email(raw)
        account = account_for_email(db, email)
        key = {"phone": None, "email": email}
    else:
        phone = normalize_us_phone(raw)
        account = user if phone == user.phone else account_for(db, phone)
        key = {"phone": phone, "email": None}
    if account and account.id == user.id:
        return {**key, "you": True, "on_cotab": True, "name": None, "account": None}
    return {
        **key,
        "you": False,
        "on_cotab": bool(account),
        "name": (account.full_name or None) if account else None,
        "account": account.id if account else None,
    }
