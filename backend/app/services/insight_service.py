"""Deterministic proactive observations. No LLM is needed to discover facts."""

import json
from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev

from sqlalchemy import case
from sqlalchemy.orm import Session

from app.models import Insight, Receipt, User
from app.services import budget_service, price_memory


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _save(
    db: Session,
    user_id: str,
    kind: str,
    key: str,
    title: str,
    body: str,
    data: dict,
    severity: str = "info",
) -> Insight:
    now = datetime.now(timezone.utc)
    row = (
        db.query(Insight)
        .filter(Insight.user_id == user_id, Insight.dedupe_key == key)
        .first()
    )
    if not row:
        row = Insight(user_id=user_id, kind=kind, dedupe_key=key)
        db.add(row)
    row.title, row.body, row.data, row.severity = (
        title,
        body,
        json.dumps(data),
        severity,
    )
    row.observed_at, row.expires_at, row.dismissed_at = (
        now,
        now + timedelta(days=14),
        None,
    )
    return row


def compute_for_user(db: Session, user_id: str) -> list[Insight]:
    now = datetime.now(timezone.utc)
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous = (month - timedelta(days=1)).replace(day=1)
    previous_last = month - timedelta(days=1)
    previous_cutoff = previous.replace(
        day=min(now.day, previous_last.day), hour=23, minute=59, second=59
    )
    rows = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.purchased_at >= previous,
        )
        .all()
    )
    current_total = sum((r.total or 0) for r in rows if _aware(r.purchased_at) >= month)
    previous_total = sum(
        (r.total or 0)
        for r in rows
        if previous <= _aware(r.purchased_at) <= previous_cutoff
    )
    saved = []
    if previous_total > 0:
        pct = (current_total - previous_total) / previous_total * 100
        if abs(pct) >= 15:
            direction = "up" if pct > 0 else "down"
            saved.append(
                _save(
                    db,
                    user_id,
                    "month_change",
                    f"month:{month:%Y-%m}",
                    f"Spending is {direction} {abs(pct):.0f}%",
                    f"You have spent {current_total:,.2f} this month versus {previous_total:,.2f} by the same point last month.",
                    {
                        "current": current_total,
                        "previous": previous_total,
                        "percent": pct,
                    },
                    "warning" if pct > 25 else "info",
                )
            )
    current = [r for r in rows if _aware(r.purchased_at) >= month]
    by_category = {}
    for row in current:
        by_category[row.category] = by_category.get(row.category, 0) + (row.total or 0)
    if by_category:
        category, amount = max(by_category.items(), key=lambda item: item[1])
        saved.append(
            _save(
                db,
                user_id,
                "top_category",
                f"category:{month:%Y-%m}:{category}",
                f"{category.title()} leads this month",
                f"Your largest category is {category} at {amount:,.2f}.",
                {"category": category, "amount": amount},
            )
        )
    values = [float(r.total or 0) for r in current if (r.total or 0) > 0]
    if len(values) >= 5 and pstdev(values) > 0:
        threshold = mean(values) + 2 * pstdev(values)
        anomaly = max(current, key=lambda r: r.total or 0)
        if (anomaly.total or 0) > threshold:
            saved.append(
                _save(
                    db,
                    user_id,
                    "anomaly",
                    f"anomaly:{anomaly.id}",
                    "An unusually large receipt",
                    f"{anomaly.merchant} was {anomaly.currency} {anomaly.total:,.2f}, well above your recent receipt average.",
                    {
                        "receipt_id": anomaly.id,
                        "merchant": anomaly.merchant,
                        "amount": anomaly.total,
                    },
                    "warning",
                )
            )
    risen = price_memory.watch(db, user_id, now - timedelta(days=120))
    if risen:
        top = risen[:3]
        names = "; ".join(
            f"{r['name']} at {r['store']}, {r['from']:,.2f} → {r['to']:,.2f}"
            for r in top
        )
        count = len(risen)
        saved.append(
            _save(
                db,
                user_id,
                "price_watch",
                f"prices:{month:%Y-%m}",
                f"{count} thing{'s' if count != 1 else ''} you buy went up",
                f"Same item, same store, higher price. {names}.",
                {"items": risen[:10]},
                "warning" if count >= 3 else "info",
            )
        )
    for state in sorted(
        budget_service.evaluate_all(db, user_id),
        key=lambda x: x["percent_used"],
        reverse=True,
    )[:2]:
        if state["percent_used"] >= 80:
            saved.append(
                _save(
                    db,
                    user_id,
                    "budget_health",
                    f"budget:{state['budget_id']}:{month:%Y-%m}",
                    f"{state['label']} budget at {state['percent_used']:.0f}%",
                    f"You have spent {state['spent']:,.2f} of {state['limit']:,.2f}.",
                    state,
                    "critical" if state["percent_used"] >= 100 else "warning",
                )
            )
    db.commit()
    return saved[:5]


def run_daily_insights(db: Session) -> dict:
    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    return {
        "users": len(users),
        "insights": sum(len(compute_for_user(db, user.id)) for user in users),
    }


def active_insights(db: Session, user_id: str, limit: int = 5) -> list[dict]:
    now = datetime.now(timezone.utc)
    rows = (
        db.query(Insight)
        .filter(
            Insight.user_id == user_id,
            Insight.deleted_at.is_(None),
            Insight.dismissed_at.is_(None),
            Insight.expires_at > now,
        )
        .order_by(
            case(
                (Insight.severity == "critical", 3),
                (Insight.severity == "warning", 2),
                else_=1,
            ).desc(),
            Insight.observed_at.desc(),
        )
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "kind": r.kind,
            "title": r.title,
            "body": r.body,
            "data": json.loads(r.data),
            "severity": r.severity,
            "observed_at": r.observed_at.isoformat(),
        }
        for r in rows
    ]
