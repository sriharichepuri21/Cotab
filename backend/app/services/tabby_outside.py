"""Tabby doing things beyond a screen: nudging a friend with a notification on
their phone about what they owe (always approved first, at most once a day per
person), and exporting a month as a spreadsheet file (CSV)."""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Receipt, ReminderLog, SplitGroup, SplitMember
from app.services import push_service, split_service, tabby_agent
from app.services.tabby_actions import _me, _resolve_people
from app.services.tabby_agent import Action, ask, err, ok

logger = logging.getLogger(__name__)

COOLDOWN = timedelta(hours=20)


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _owed_by(db: Session, user_id: str, name: str) -> List[tuple]:
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
            if t["from"] == them.id and t["to"] == me.id and t["amount"] >= 0.01:
                rows.append((group, them, round(t["amount"], 2)))
    return rows


def _recently_reminded(db: Session, user_id: str, member_id: str) -> bool:
    since = datetime.now(timezone.utc) - COOLDOWN
    return (
        db.query(ReminderLog)
        .filter(
            ReminderLog.user_id == user_id,
            ReminderLog.kind == "friend_push",
            ReminderLog.period_key == member_id,
            ReminderLog.created_at >= since,
        )
        .first()
        is not None
    )


# --- send_reminder ------------------------------------------------------------------


def prepare_reminder(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    who = str(args.get("person") or "").strip()
    if not who:
        return ask("Ask who to remind.")
    resolved = _resolve_people(db, user_id, [who])
    if resolved["status"] != "ok":
        return resolved
    name = resolved["data"][0][0]
    rows = _owed_by(db, user_id, name)
    tab = str(args.get("group") or "").strip().lower()
    if tab:
        rows = [r for r in rows if tab in r[0].name.lower()] or rows
    if not rows:
        return ask(f"{name} doesn't owe them anything. Tell the person.")
    if len(rows) > 1:
        return ask(
            f"{name} owes on more than one tab. Ask which one.",
            options=[f"{g.name}: {_money(a)}" for g, _, a in rows][:4],
        )
    group, member, amount = rows[0]
    if not push_service.can_notify(db, member.user_id):
        return ask(
            f"{member.name} doesn't have Cotab notifications on, so Tabby can't nudge "
            f"them. Offer a short friendly message the person can send themselves, "
            f"saying they owe {_money(amount)}, and show a button to the tab's share "
            f"link with open_page (path /share/{group.share_code}, label 'Tab link')."
        )
    if _recently_reminded(db, user_id, member.id):
        return ask(
            f"Tabby already nudged {member.name} today. Tell the person and suggest "
            "waiting until tomorrow."
        )
    return ok(
        {
            "summary": f"Send {member.name} a notification reminding them they owe you "
            f"{_money(amount)} on {group.name}. It can't be unsent.",
            "step": {"group_id": group.id, "member_id": member.id, "amount": amount},
        }
    )


def send_reminder(
    db: Session, user_id: str, group_id: str, member_id: str, amount: float
) -> Dict:
    group = db.get(SplitGroup, group_id)
    member = db.get(SplitMember, member_id)
    if (
        group is None
        or member is None
        or member.group_id != group.id
        or group.id not in {g.id for g in split_service.groups_for_user(db, user_id)}
    ):
        return err("That tab is gone.")
    if _recently_reminded(db, user_id, member.id):
        return err(f"{member.name} was nudged today already.")
    _, my_name = _me(db, user_id)
    where = f"your tab with {my_name}" if group.kind == "direct" else group.name
    delivered = push_service.send(
        db,
        member.user_id,
        f"Reminder from {my_name}",
        f"You owe {my_name} {_money(amount)} on {where}. Tap to see it and pay.",
        f"/app/groups/{group.id}",
    )
    if not delivered:
        return err(f"Couldn't reach {member.name}'s phone.")
    db.add(
        ReminderLog(
            user_id=user_id,
            kind="friend_push",
            period_key=member.id,
            channel="push",
        )
    )
    db.commit()
    # No undo: a notification can't be unsent.
    return ok({"open": f"/app/groups/{group.id}", "tab": group.name})


tabby_agent.register(
    Action(
        "send_reminder",
        prepare_reminder,
        send_reminder,
        None,
        "Checking what's owed…",
    ),
)


# --- export ---------------------------------------------------------------------------


def month_csv(db: Session, user_id: str, month: str) -> Optional[str]:
    """Every purchase and item in a month, one row per item, for a spreadsheet."""
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError:
        return None
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    receipts = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.purchased_at
            >= datetime(start.year, start.month, 1, tzinfo=timezone.utc),
            Receipt.purchased_at
            < datetime(end.year, end.month, 1, tzinfo=timezone.utc),
        )
        .order_by(Receipt.purchased_at.asc())
        .all()
    )
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "Date",
            "Store",
            "Category",
            "Item",
            "Quantity",
            "Item price",
            "Receipt total",
            "Tax",
            "Currency",
        ]
    )

    def safe(value: Any) -> Any:
        # Spreadsheet apps run cells that start with these as formulas.
        text = str(value or "")
        return "'" + text if text[:1] in ("=", "+", "-", "@") else text

    for r in receipts:
        day = r.purchased_at.date().isoformat() if r.purchased_at else ""
        lines = [li for li in r.line_items if li.deleted_at is None] or [None]
        for li in lines:
            writer.writerow(
                [
                    day,
                    safe(r.merchant),
                    r.category,
                    safe((li.item_name or li.description) if li else ""),
                    li.quantity if li else "",
                    round(li.total_price or 0, 2) if li else "",
                    round(r.total or 0, 2),
                    round(r.tax or 0, 2),
                    r.currency or "USD",
                ]
            )
    return out.getvalue()


def export_month(db: Session, user_id: str, month: Optional[str] = None) -> Dict:
    """A download button for a month of purchases as a spreadsheet (CSV)."""
    month = (month or "").strip()[:7] or datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError:
        return ask("Ask which month (like October 2026).")
    return ok(
        {
            "download": {
                "label": f"Download {start:%B %Y}",
                "href": f"/tabby/export?month={month}",
                "filename": f"cotab-{month}.csv",
            },
            "note": "The download button appears under your reply.",
        }
    )
