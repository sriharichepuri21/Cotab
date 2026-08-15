from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Insight, User
from app.services.insight_service import active_insights

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("")
def list_insights(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return active_insights(db, user.id)


@router.post("/{insight_id}/dismiss")
def dismiss(
    insight_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(Insight)
        .filter(
            Insight.id == insight_id,
            Insight.user_id == user.id,
            Insight.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Insight not found")
    row.dismissed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
