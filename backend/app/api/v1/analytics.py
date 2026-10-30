from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.schemas import ReceiptOut
from app.services import analytics_service
from app.services.categories import _normalize_category
from app.services.my_share import spending

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


@router.get("/month/receipts")
def month_receipts(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    category: Optional[str] = Query(None, min_length=1, max_length=64),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The purchases behind one category total (or the whole month), including
    receipts a friend added to a shared tab. Amounts are the viewer's share,
    matching Insights."""
    try:
        start = date(int(month[:4]), int(month[5:]), 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a month like 2026-10.")
    if category:
        category = _normalize_category(category) or category.strip().lower()
    start, end_exclusive = analytics_service.month_bounds(start)
    rows = [
        spend
        for spend in spending(db, user.id, start, end_exclusive)
        if not category or (spend.receipt.category or "other") == category
    ]
    rows.sort(
        key=lambda spend: spend.receipt.purchased_at or spend.receipt.created_at,
        reverse=True,
    )
    out = []
    for spend in rows:
        receipt = ReceiptOut.model_validate(spend.receipt).model_dump()
        receipt.update(
            my_share=spend.amount,
            split_group_id=spend.split.group_id if spend.split else None,
            owned=spend.receipt.user_id == user.id,
        )
        out.append(receipt)
    return out
