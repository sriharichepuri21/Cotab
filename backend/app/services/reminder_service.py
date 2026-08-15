from datetime import datetime, timedelta, timezone
from typing import Dict, List

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Budget, Receipt, ReminderLog, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def has_been_sent(db: Session, user_id: str, kind: str, period_key: str) -> bool:
    return (
        db.query(ReminderLog)
        .filter(
            ReminderLog.user_id == user_id,
            ReminderLog.kind == kind,
            ReminderLog.period_key == period_key,
        )
        .first()
        is not None
    )


def log_reminder(
    db: Session, user_id: str, kind: str, period_key: str, payload: str = ""
) -> None:
    db.add(
        ReminderLog(user_id=user_id, kind=kind, period_key=period_key, payload=payload)
    )
    db.commit()


def _send(user: User, subject: str, body: str) -> None:
    """MVP: log-only delivery. Telegram/email adapters plug in here."""
    print(f"[reminder] to={user.email} subject={subject}\n{body}")


def run_weekly_digest(db: Session) -> Dict:
    now = _now()
    week_key = f"{now.isocalendar().year}-W{now.isocalendar().week:02d}"
    week_ago = now - timedelta(days=7)
    sent = 0

    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    for user in users:
        if has_been_sent(db, user.id, "weekly_digest", week_key):
            continue
        rows = (
            db.query(Receipt.category, func.sum(Receipt.total))
            .filter(
                Receipt.user_id == user.id,
                Receipt.deleted_at.is_(None),
                Receipt.status.in_(["extracted", "reviewed"]),
                Receipt.created_at >= week_ago,
            )
            .group_by(Receipt.category)
            .all()
        )
        if not rows:
            log_reminder(db, user.id, "weekly_digest", week_key, "no spend")
            continue

        total = sum(r[1] or 0 for r in rows)
        lines = [f"• {cat}: ${amt:,.2f}" for cat, amt in rows]
        body = f"Weekly spend: ${total:,.2f}\n" + "\n".join(lines)
        _send(user, "Your weekly expense digest", body)
        log_reminder(db, user.id, "weekly_digest", week_key, body)
        sent += 1

    return {"period": week_key, "sent": sent}


def run_monthly_report(db: Session) -> Dict:
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_month = (month_start - timedelta(days=1)).replace(day=1)
    period = prev_month.strftime("%Y-%m")

    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    sent = 0
    for user in users:
        if has_been_sent(db, user.id, "monthly_report", period):
            continue
        rows = (
            db.query(Receipt.category, func.sum(Receipt.total), func.count(Receipt.id))
            .filter(
                Receipt.user_id == user.id,
                Receipt.deleted_at.is_(None),
                Receipt.status.in_(["extracted", "reviewed"]),
                Receipt.created_at >= prev_month,
                Receipt.created_at < month_start,
            )
            .group_by(Receipt.category)
            .all()
        )
        total = sum(r[1] or 0 for r in rows)
        body = f"Monthly report {period}: ${total:,.2f} across {sum(r[2] for r in rows)} receipts"
        _send(user, f"Your {period} expense report", body)
        log_reminder(db, user.id, "monthly_report", period, body)
        sent += 1

    return {"period": period, "sent": sent}


def check_budget_alerts(db: Session, user_id: str) -> List[Dict]:
    """Event-driven: run after each successful extraction. Thresholds 50/80/100%."""
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period = now.strftime("%Y-%m")
    alerts = []

    # Delegate the arithmetic to budget_service so the digest, the dashboard and
    # the post-upload toast can't disagree about the same budget. This also picks
    # up the non-category levels and non-monthly periods for free, which the old
    # inline query could not express.
    from app.services import budget_service

    for state in budget_service.evaluate_all(db, user_id):
        for threshold in state["thresholds"]:
            if state["percent_used"] < threshold:
                continue
            key = f"{period}:{state['budget_id']}:{threshold}"
            if has_been_sent(db, user_id, "budget_alert", key):
                continue
            body = (
                f"Budget alert: {state['label']} at {state['percent_used']:.0f}% "
                f"(${state['spent']:,.2f} of ${state['limit']:,.2f})"
            )
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                _send(user, f"Budget {threshold}% — {state['label']}", body)
            log_reminder(db, user_id, "budget_alert", key, body)
            alerts.append(
                {
                    "budget_id": state["budget_id"],
                    "label": state["label"],
                    "pct": state["percent_used"],
                    "threshold": threshold,
                }
            )

    return alerts


def run_daily_digest(db: Session) -> Dict:
    """Nudge for receipts stuck in failed/stale processing states."""
    now = _now()
    stale_before = now - timedelta(hours=24)
    day_key = now.strftime("%Y-%m-%d")

    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    sent = 0
    for user in users:
        if has_been_sent(db, user.id, "daily_digest", day_key):
            continue
        failed = (
            db.query(func.count(Receipt.id))
            .filter(
                Receipt.user_id == user.id,
                Receipt.deleted_at.is_(None),
                Receipt.status == "failed",
                Receipt.created_at >= stale_before,
            )
            .scalar()
            or 0
        )
        pending = (
            db.query(func.count(Receipt.id))
            .filter(
                Receipt.user_id == user.id,
                Receipt.deleted_at.is_(None),
                Receipt.status == "extracted",  # awaiting human review
            )
            .scalar()
            or 0
        )
        if failed or pending:
            body = f"You have {pending} receipts awaiting review and {failed} failed scans."
            _send(user, "Receipts need your attention", body)
            log_reminder(db, user.id, "daily_digest", day_key, body)
            sent += 1

    return {"period": day_key, "sent": sent}
