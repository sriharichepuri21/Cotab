from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
def summary(
    trend_months: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Everything the dashboard needs in one call.

    One endpoint rather than five so the home page isn't a waterfall of requests
    on a cold free-tier backend. The aggregation lives in analytics_service,
    which the chat tools also read from, so the dashboard and the assistant can't
    quote different numbers for the same question.
    """
    return analytics_service.dashboard_summary(db, user.id, trend_months=trend_months)


@router.get("/month")
def month(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One month's total, categories and stores, for picking a past month on
    Insights. Same figures as the summary (your share after splits)."""
    try:
        start = date(int(month[:4]), int(month[5:]), 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a month like 2026-10.")
    start, end_exclusive = analytics_service.month_bounds(start)
    return {
        "month": month,
        "totals": analytics_service.totals_for_period(
            db, user.id, start, end_exclusive
        ),
        "categories": analytics_service.category_breakdown(
            db, user.id, start, end_exclusive
        ),
        "merchants": analytics_service.merchant_breakdown(
            db, user.id, start, end_exclusive
        )[:5],
    }
