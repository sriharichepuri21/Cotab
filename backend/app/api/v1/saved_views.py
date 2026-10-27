import json
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import SavedView, User

router = APIRouter(prefix="/saved-views", tags=["saved-views"])

# Only filters the receipts list actually understands may be stored. An
# allowlist rather than free-form JSON: the blob is echoed straight back into a
# query string by the frontend, so anything unrecognised is at best dead weight
# and at worst a confusing no-op the user thinks is filtering.
ALLOWED_FILTER_KEYS = {
    "q",
    "category",
    "merchant",
    "status",
    "start_date",
    "end_date",
    "min_amount",
    "max_amount",
    "sort",
    "order",
}


class SavedViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: Dict[str, Any] = Field(default_factory=dict)


class SavedViewOut(BaseModel):
    id: str
    name: str
    filters: Dict[str, Any]


def _to_out(row: SavedView) -> SavedViewOut:
    try:
        filters = json.loads(row.filters or "{}")
    except (ValueError, TypeError):
        # A malformed blob shouldn't 500 the whole list; an empty view is
        # recoverable by re-saving it.
        filters = {}
    return SavedViewOut(id=row.id, name=row.name, filters=filters)


def _clean(filters: Dict[str, Any]) -> Dict[str, Any]:
    return {
        k: v
        for k, v in filters.items()
        if k in ALLOWED_FILTER_KEYS and v not in (None, "")
    }


@router.get("", response_model=List[SavedViewOut], include_in_schema=False)
@router.get("/", response_model=List[SavedViewOut])
def list_views(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(SavedView)
        .filter(SavedView.user_id == user.id, SavedView.deleted_at.is_(None))
        .order_by(SavedView.created_at.asc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post(
    "",
    response_model=SavedViewOut,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
@router.post("/", response_model=SavedViewOut, status_code=status.HTTP_201_CREATED)
def create_view(
    body: SavedViewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Saving under an existing name overwrites it — that matches what the button
    means ("save this view"), and avoids a pile of "Coffee (2)" duplicates."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be blank")

    existing = (
        db.query(SavedView)
        .filter(
            SavedView.user_id == user.id,
            SavedView.name == name,
            SavedView.deleted_at.is_(None),
        )
        .first()
    )
    payload = json.dumps(_clean(body.filters))
    if existing:
        existing.filters = payload
        db.commit()
        db.refresh(existing)
        return _to_out(existing)

    row = SavedView(user_id=user.id, name=name, filters=payload)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_view(
    view_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(SavedView)
        .filter(
            SavedView.id == view_id,
            SavedView.user_id == user.id,
            SavedView.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved view not found")
    from datetime import datetime, timezone

    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return None
