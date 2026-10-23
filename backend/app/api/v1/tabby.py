"""Tabby's own page: what it did (with undo), what it remembers, its rules,
the month wrap-up and the month export."""

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import TabbyMemory, TabbyRule, User
from app.services import tabby_agent, tabby_memory, tabby_nudges, tabby_outside
from app.services import tabby_rules as rules_service

router = APIRouter(prefix="/tabby", tags=["tabby"])


@router.get("/activity")
def activity(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything Tabby did, newest first, grouped by task."""
    tabby_agent._load()
    return tabby_agent.activity(db, user.id)


@router.post("/runs/{run_id}/undo")
def undo(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Undo a whole task: every step, last first."""
    result = tabby_agent.undo_run(db, user.id, run_id)
    if result["status"] != "ok":
        raise HTTPException(status_code=409, detail=result["hint"])
    return result["data"]


# --- memory ------------------------------------------------------------------------


class MemoryIn(BaseModel):
    text: str = Field(min_length=3, max_length=280)


def _memory_out(row: TabbyMemory) -> dict:
    return {
        "id": row.id,
        "text": row.text,
        "kind": row.kind,
        "at": tabby_agent.iso(row.created_at),
    }


@router.get("/memories")
def list_memories(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return [_memory_out(m) for m in tabby_memory.memories(db, user.id)]


@router.post("/memories")
def add_memory(
    body: MemoryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    prepared = tabby_memory.prepare_remember(
        db, user.id, {"text": body.text}, tabby_agent.Plan()
    )
    if prepared["status"] != "ok":
        raise HTTPException(status_code=409, detail="Tabby already remembers that.")
    row = TabbyMemory(user_id=user.id, **prepared["data"]["step"])
    db.add(row)
    db.commit()
    return _memory_out(row)


@router.delete("/memories/{memory_id}", status_code=204)
def delete_memory(
    memory_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = db.get(TabbyMemory, memory_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


# --- rules -------------------------------------------------------------------------


class RuleUpdate(BaseModel):
    active: bool


def _rule_out(row: TabbyRule) -> dict:
    return {
        "id": row.id,
        "summary": row.summary,
        "active": row.active,
        "action": row.action,
        "store": row.store,
        "category": row.category,
        "params": json.loads(row.params or "{}"),
        "run_count": row.run_count or 0,
        "last_run_at": tabby_agent.iso(row.last_run_at),
    }


def _own_rule(db: Session, user: User, rule_id: str) -> TabbyRule:
    row = db.get(TabbyRule, rule_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.get("/rules")
def list_rules(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [_rule_out(r) for r in rules_service.rules(db, user.id)]


@router.patch("/rules/{rule_id}")
def update_rule(
    rule_id: str,
    body: RuleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = _own_rule(db, user, rule_id)
    row.active = body.active
    db.commit()
    return _rule_out(row)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = _own_rule(db, user, rule_id)
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


# --- wrap-up and export -----------------------------------------------------------


def _month(month: Optional[str]) -> str:
    if month:
        try:
            datetime.strptime(month, "%Y-%m")
            return month
        except ValueError:
            raise HTTPException(status_code=422, detail="Month looks like 2026-10")
    now = datetime.now(timezone.utc)
    return (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


@router.get("/wrap")
def month_wrap(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A month in a few numbers (last month by default)."""
    return tabby_nudges.wrap(db, user.id, _month(month))


@router.get("/export")
def export(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A month of purchases, one row per item, as a CSV spreadsheet."""
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    body = tabby_outside.month_csv(db, user.id, _month(month))
    if body is None:
        raise HTTPException(status_code=422, detail="Month looks like 2026-10")
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="cotab-{month}.csv"'},
    )
