from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.exports import require_cron_secret
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User
from app.services import recovery
from app.services.insight_service import run_daily_insights
from app.services.reminder_service import (
    check_budget_alerts,
    run_daily_digest,
    run_monthly_report,
    run_weekly_digest,
)

router = APIRouter(prefix="/reminders", tags=["reminders"])


@router.post("/budget-alerts")
def trigger_budget_alerts(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return {"alerts": check_budget_alerts(db, user.id)}


@router.post("/cron/weekly-digest", dependencies=[Depends(require_cron_secret)])
def cron_weekly_digest(db: Session = Depends(get_db)):
    return run_weekly_digest(db)


@router.post("/cron/monthly-report", dependencies=[Depends(require_cron_secret)])
def cron_monthly_report(db: Session = Depends(get_db)):
    return run_monthly_report(db)


@router.post("/cron/daily-digest", dependencies=[Depends(require_cron_secret)])
def cron_daily_digest(db: Session = Depends(get_db)):
    return run_daily_digest(db)


@router.post("/cron/daily-insights", dependencies=[Depends(require_cron_secret)])
def cron_daily_insights(db: Session = Depends(get_db)):
    return run_daily_insights(db)


@router.post("/cron/recovery", dependencies=[Depends(require_cron_secret)])
def cron_recovery(db: Session = Depends(get_db)):
    """Clean up work a stopped process left part-way (Tabby plans, emails)."""
    return recovery.run_all(db)
