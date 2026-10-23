"""Tabby doing things beyond the app: emailing a friend a friendly reminder of
what they owe (always approved first, never more than once in three days per
person), and exporting a month as a spreadsheet file (CSV)."""

from __future__ import annotations

import csv
import html
import io
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models import Receipt, ReminderLog, SplitGroup, SplitMember, User
from app.services import email_verification, pay_links, split_service, tabby_agent
from app.services.tabby_actions import _me, _resolve_people
from app.services.tabby_agent import Action, ask, err, ok

logger = logging.getLogger(__name__)

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COOLDOWN = timedelta(days=3)


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
            ReminderLog.kind == "friend_reminder",
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
    if _recently_reminded(db, user_id, member.id):
        return ask(
            f"Tabby already reminded {member.name} in the last 3 days. Tell the person "
            "and suggest waiting a bit."
        )
    email = str(args.get("email") or "").strip() or (member.email or "")
    if not email:
        return ask(
            f"Tabby needs {member.name}'s email to send it. Ask for it, or offer to "
            "write a message they can send themselves."
        )
    if not EMAIL.match(email):
        return ask("That email doesn't look right. Ask for it again.")
    user = db.get(User, user_id)
    handles = pay_links.load(user.pay_handles)
    ways = ", ".join(
        {"venmo": "Venmo", "paypal": "PayPal", "cashapp": "Cash App", "zelle": "Zelle"}[
            k
        ]
        for k in handles
    )
    summary = (
        f"Email {member.name} ({email}) a friendly reminder that they owe you "
        f"{_money(amount)} on {group.name}"
        + (f", with your {ways} to pay you" if ways else "")
        + ". An email can't be unsent."
    )
    return ok(
        {
            "summary": summary,
            "step": {
                "group_id": group.id,
                "member_id": member.id,
                "email": email,
                "amount": amount,
            },
        }
    )


def _reminder_email(me: str, friend: str, amount: float, tab: str, links: List[Dict]):
    pay_text = "\n".join(
        f"{link['label']}: {link['url'] or link.get('copy')}" for link in links
    )
    text = (
        f"Hi {friend},\n\n"
        f"{me} asked me to send a friendly reminder: you owe {me} {_money(amount)} "
        f"on {tab}.\n\n"
        + (f"You can pay {me} here:\n{pay_text}\n\n" if links else "")
        + "Thanks!\nTabby, from Cotab"
    )
    buttons = "".join(
        (
            (
                f'<a href="{html.escape(link["url"])}" style="display:inline-block;'
                "margin:0 8px 8px 0;padding:12px 18px;border-radius:999px;background:#0F3D31;"
                f'color:#D7F45B;font-weight:800;text-decoration:none">Pay with '
                f'{html.escape(link["label"])}</a>'
            )
            if link.get("url")
            else (
                f'<p style="margin:0 0 8px;font-size:14px">{html.escape(link["label"])}: '
                f"<b>{html.escape(link.get('copy') or '')}</b></p>"
            )
        )
        for link in links
    )
    page = f"""<!doctype html><html><body style="margin:0;background:#F3F4F1;font-family:Manrope,Helvetica,Arial,sans-serif;color:#0C110E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border-radius:24px;padding:32px"><tr><td>
<p style="margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-0.5px">cotab</p>
<p style="margin:24px 0 8px;font-size:16px">Hi {html.escape(friend)},</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">{html.escape(me)} asked me to send a friendly reminder: you owe {html.escape(me)} <b>{_money(amount)}</b> on {html.escape(tab)}.</p>
{buttons}
<p style="margin:24px 0 0;font-size:14px;font-weight:700">Thanks! Tabby, from Cotab</p>
</td></tr></table></td></tr></table></body></html>"""
    return text, page


def send_reminder(
    db: Session, user_id: str, group_id: str, member_id: str, email: str, amount: float
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
        return err(f"{member.name} was reminded in the last 3 days.")
    user, my_name = _me(db, user_id)
    links = pay_links.links(
        pay_links.load(user.pay_handles), amount, f"Cotab: {group.name}"
    )
    subject = f"A friendly reminder from {my_name}"
    text, page = _reminder_email(my_name, member.name, amount, group.name, links)
    settings = get_settings()
    if email_verification.outbox is not None:
        email_verification.outbox.append(
            {"to": email, "subject": subject, "text": text, "purpose": "reminder"}
        )
    elif settings.email_sending_enabled():
        response = httpx.post(
            f"{email_verification.RESEND_API}/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [email],
                "reply_to": user.email,
                "subject": subject,
                "text": text,
                "html": page,
            },
            timeout=15,
        )
        if response.status_code >= 300:
            logger.error("Resend refused a reminder: %s", response.text)
            return err("The email couldn't be sent just now.")
    else:
        logger.warning("Email sending is off; reminder to %s not sent", email)
        return err("Email isn't set up on this server.")
    if not member.email:
        member.email = email
    db.add(
        ReminderLog(
            user_id=user_id,
            kind="friend_reminder",
            period_key=member.id,
            channel="email",
            payload=email,
        )
    )
    db.commit()
    # No undo: an email can't be unsent.
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
