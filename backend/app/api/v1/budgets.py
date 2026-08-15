from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Budget, User
from app.services import budget_service
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category

router = APIRouter(prefix="/budgets", tags=["budgets"])


class BudgetIn(BaseModel):
    level: Literal["total", "category", "merchant", "item"] = "category"
    target: str = ""
    period: Literal["weekly", "monthly", "yearly"] = "monthly"
    amount: float = Field(gt=0)
    alert_thresholds: Optional[str] = None

    @field_validator("target")
    @classmethod
    def _trim(cls, v: str) -> str:
        return (v or "").strip()


class BudgetOut(BaseModel):
    id: str
    level: str
    target: str
    period: str
    amount: float
    alert_thresholds: str


def _validate_scope(body: BudgetIn) -> str:
    """Return the normalized target, or raise 422.

    A category budget whose target isn't a real category would silently never
    match anything — it has to fail loudly at creation, not quietly at evaluation.
    """
    if body.level == "total":
        return ""  # target is meaningless here; ignore whatever was sent
    if not body.target:
        raise HTTPException(
            status_code=422, detail=f"A {body.level} budget needs a target"
        )
    if body.level == "category":
        cat = _normalize_category(body.target)
        if not cat:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown category. Try one of: {', '.join(CANONICAL_CATEGORIES)}",
            )
        return cat
    return body.target


def _to_out(b: Budget) -> BudgetOut:
    return BudgetOut(
        id=b.id,
        level=b.level,
        target=b.target,
        period=b.period,
        amount=b.amount,
        alert_thresholds=b.alert_thresholds or "80,100,120",
    )


def _owned(db: Session, user: User, budget_id: str) -> Budget:
    b = (
        db.query(Budget)
        .filter(
            Budget.id == budget_id,
            Budget.user_id == user.id,
            Budget.deleted_at.is_(None),
        )
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    return b


@router.get("/")
def list_budgets(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Budgets with their current state, worst offender first.

    Returns the evaluation rather than the raw rows: a budget without its
    progress is not useful to any caller, and computing it here keeps the page
    to a single request.
    """
    return budget_service.evaluate_all(db, user.id)


@router.post("/", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
def create_budget(
    body: BudgetIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upsert on (level, target, period) — re-saving the same scope edits it
    rather than stacking duplicates that each fire their own alert."""
    target = _validate_scope(body)
    existing = (
        db.query(Budget)
        .filter(
            Budget.user_id == user.id,
            Budget.level == body.level,
            Budget.target == target,
            Budget.period == body.period,
            Budget.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        existing.amount = body.amount
        if body.alert_thresholds:
            existing.alert_thresholds = body.alert_thresholds
        db.commit()
        db.refresh(existing)
        return _to_out(existing)

    b = Budget(
        user_id=user.id,
        level=body.level,
        target=target,
        period=body.period,
        amount=body.amount,
        alert_thresholds=body.alert_thresholds or "80,100,120",
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _to_out(b)


@router.patch("/{budget_id}", response_model=BudgetOut)
def update_budget(
    budget_id: str,
    body: BudgetIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = _owned(db, user, budget_id)
    b.target = _validate_scope(body)
    b.level = body.level
    b.period = body.period
    b.amount = body.amount
    if body.alert_thresholds:
        b.alert_thresholds = body.alert_thresholds
    db.commit()
    db.refresh(b)
    return _to_out(b)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone

    b = _owned(db, user, budget_id)
    b.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return None
