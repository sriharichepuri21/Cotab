"""Operator-only views, protected by the cron secret (X-Cron-Secret header).

`GET /admin/ai-usage?days=7` shows what the AI has cost: calls, tokens and
estimated dollars, by feature and by model, against today's caps.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.v1.exports import require_cron_secret
from app.config.settings import get_settings
from app.db.session import get_db
from app.services import ai_usage

router = APIRouter(tags=["admin"], dependencies=[Depends(require_cron_secret)])


@router.get("/admin/ai-usage")
def ai_usage_report(days: int = Query(1, ge=1, le=90), db: Session = Depends(get_db)):
    settings = get_settings()
    s = ai_usage.summary(db, days=days)
    today = ai_usage.spent_today(db)
    return {
        "since": s.since.isoformat(),
        "days": days,
        "calls": s.calls,
        "people": s.people,
        "input_tokens": s.input_tokens,
        "output_tokens": s.output_tokens,
        "estimated_cost_usd": s.cost_usd,
        "by_feature": s.by_feature,
        "by_model": s.by_model,
        "today": {
            "estimated_cost_usd": round(today, 6),
            "app_daily_budget_usd": settings.ai_daily_budget_usd,
            "user_daily_budget_usd": settings.ai_user_daily_budget_usd,
            "budget_used_percent": (
                round(100 * today / settings.ai_daily_budget_usd, 1)
                if settings.ai_daily_budget_usd
                else None
            ),
        },
        "models": {
            "everyday": settings.gemini_model,
            "second_look": settings.gemini_upgrade_model or None,
        },
        "note": "Estimated at paid-tier prices; on Gemini's free tier the bill is $0.",
    }
