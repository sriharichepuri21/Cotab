"""Tabby as an agent: plan, approve, do, undo.

Every change Tabby can make in the app is an `Action` with three parts:

  prepare(db, user_id, args, plan)  checks it can be done and returns the exact
                                    sentence for the plan, or what to ask
  execute(db, user_id, **step)      does it (only after the person approves)
                                    and returns what it takes to undo it
  undo(db, user_id, **undo)         puts things back

During a chat turn, each change Tabby wants to make is prepared and added to
one plan. The plan is shown as a checklist with a single Approve button; the
steps then run in order, each is written to the activity log, and the whole
run can be undone with one tap. If a step fails, the ones before it are undone
so nothing is left half-done.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import TabbyActivity

logger = logging.getLogger(__name__)


def iso(value: Optional[datetime]) -> Optional[str]:
    """A time the browser reads correctly (SQLite drops the time zone)."""
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def ok(data: Any) -> Dict[str, Any]:
    return {"status": "ok", "data": data}


def ask(hint: str, **data: Any) -> Dict[str, Any]:
    """Not a failure: Tabby needs the person to clarify something."""
    return {"status": "needs_clarification", "hint": hint, "data": data}


def err(hint: str) -> Dict[str, Any]:
    return {"status": "error", "hint": hint}


@dataclass
class Plan:
    """The steps prepared so far in this turn. Later steps can see earlier ones,
    so "make a Tahoe group, then split the cabin on it" works in one plan."""

    steps: List[Dict[str, Any]] = field(default_factory=list)
    new_groups: Dict[str, List[str]] = field(default_factory=dict)
    removed_splits: set = field(default_factory=set)

    def add(self, action: str, step: Dict[str, Any], summary: str) -> int:
        self.steps.append({"action": action, "step": step, "summary": summary})
        return len(self.steps)


@dataclass
class Action:
    name: str
    prepare: Callable[..., Dict[str, Any]]
    execute: Callable[..., Dict[str, Any]]
    undo: Optional[Callable[..., Dict[str, Any]]]
    status: str = "Working on it…"


ACTIONS: Dict[str, Action] = {}


def register(*actions: Action) -> None:
    for action in actions:
        ACTIONS[action.name] = action


def _load() -> None:
    """Import the action modules (they register themselves)."""
    from app.services import (  # noqa: F401
        tabby_actions,
        tabby_budget_actions,
        tabby_memory,
        tabby_outside,
        tabby_profile_actions,
        tabby_receipt_actions,
        tabby_rules,
        tabby_tab_actions,
    )


def prepare(
    name: str, db: Session, user_id: str, args: Dict[str, Any], plan: Plan
) -> Dict[str, Any]:
    _load()
    action = ACTIONS.get(name)
    if action is None:
        return err(f"Unknown action '{name}'.")
    try:
        result = action.prepare(db, user_id, args or {}, plan)
    except Exception:
        logger.exception("Preparing %s failed (args=%s)", name, args)
        return err("That couldn't be prepared. Try again with different details.")
    if result.get("status") != "ok":
        return result
    data = result["data"]
    position = plan.add(name, data["step"], data["summary"])
    return {
        "status": "added_to_plan",
        "step": position,
        "summary": data["summary"],
        "note": "Added to the plan. Nothing happens until the person approves it.",
    }


def plan_summary(steps: List[Dict[str, Any]]) -> str:
    if len(steps) == 1:
        return steps[0]["summary"]
    return f"{len(steps)} steps: " + " ".join(
        f"{i}. {s['summary']}" for i, s in enumerate(steps, 1)
    )


def _record(
    db: Session,
    user_id: str,
    run_id: str,
    position: int,
    action: str,
    summary: str,
    data: Dict[str, Any],
    source: str,
) -> TabbyActivity:
    row = TabbyActivity(
        user_id=user_id,
        run_id=run_id,
        position=position,
        action=action,
        summary=summary[:512],
        undo=json.dumps(data["undo"]) if data.get("undo") is not None else None,
        open_path=data.get("open"),
        status="done",
        source=source,
    )
    db.add(row)
    db.commit()
    return row


def run(
    db: Session,
    user_id: str,
    steps: List[Dict[str, Any]],
    run_id: Optional[str] = None,
    source: str = "chat",
) -> Dict[str, Any]:
    """Carry out an approved plan, step by step. All or nothing."""
    _load()
    run_id = run_id or str(uuid.uuid4())
    done: List[TabbyActivity] = []
    results = []
    extra: Dict[str, Any] = {}
    for position, step in enumerate(steps):
        action = ACTIONS.get(step["action"])
        try:
            result = (
                action.execute(db, user_id, **step["step"])
                if action
                else err("Unknown action.")
            )
        except Exception:
            logger.exception("Step %s failed", step["action"])
            db.rollback()
            result = err("Something went wrong on that step.")
        if result.get("status") != "ok":
            for row in reversed(done):
                _undo_row(db, user_id, row)
            return {
                "status": "error",
                "hint": f"Step {position + 1} ({step['summary']}) couldn't be done: "
                f"{result.get('hint', 'unknown problem')}. Nothing was changed.",
            }
        data = result.get("data") or {}
        extra.update({k: data[k] for k in ("tab", "group_id") if k in data})
        done.append(
            _record(
                db,
                user_id,
                run_id,
                position,
                step["action"],
                step["summary"],
                data,
                source,
            )
        )
        results.append(
            {
                "summary": step["summary"],
                "open": data.get("open"),
                "undoable": data.get("undo") is not None,
            }
        )
    opens = [r["open"] for r in results if r.get("open")]
    return ok(
        {
            "run_id": run_id,
            "steps": results,
            "open": opens[-1] if opens else None,
            "undoable": any(r["undoable"] for r in results),
            **extra,
        }
    )


def _undo_row(db: Session, user_id: str, row: TabbyActivity) -> Dict[str, Any]:
    action = ACTIONS.get(row.action)
    if row.status != "done":
        return ok({"already": True})
    if action is None or action.undo is None or row.undo is None:
        return err("This step can't be undone.")
    try:
        result = action.undo(db, user_id, **json.loads(row.undo))
    except Exception:
        logger.exception("Undoing %s failed", row.action)
        db.rollback()
        result = err("Undo failed.")
    if result.get("status") == "ok":
        row.status = "undone"
        row.undone_at = datetime.now(timezone.utc)
        db.commit()
    return result


def undo_run(db: Session, user_id: str, run_id: str) -> Dict[str, Any]:
    """Undo every step of a run, last first."""
    _load()
    rows = (
        db.query(TabbyActivity)
        .filter(
            TabbyActivity.user_id == user_id,
            TabbyActivity.run_id == run_id,
            TabbyActivity.deleted_at.is_(None),
        )
        .order_by(TabbyActivity.position.desc())
        .all()
    )
    if not rows:
        return err("Nothing to undo.")
    problems = []
    for row in rows:
        result = _undo_row(db, user_id, row)
        if result.get("status") != "ok":
            problems.append(f"{row.summary}: {result.get('hint')}")
    if problems:
        return err(" ".join(problems))
    return ok({"run_id": run_id, "undone": len(rows)})


def activity(db: Session, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Recent runs, newest first, each with its steps."""
    rows = (
        db.query(TabbyActivity)
        .filter(
            TabbyActivity.user_id == user_id,
            TabbyActivity.deleted_at.is_(None),
        )
        .order_by(TabbyActivity.created_at.desc(), TabbyActivity.position.asc())
        .limit(limit * 4)
        .all()
    )
    runs: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        entry = runs.setdefault(
            row.run_id,
            {
                "run_id": row.run_id,
                "at": iso(row.created_at),
                "source": row.source,
                "steps": [],
            },
        )
        entry["steps"].append(
            {
                "position": row.position,
                "summary": row.summary,
                "status": row.status,
                "open": row.open_path,
                "undoable": row.undo is not None,
            }
        )
    out = []
    for entry in list(runs.values())[:limit]:
        entry["steps"].sort(key=lambda s: s["position"])
        entry["status"] = (
            "undone" if all(s["status"] == "undone" for s in entry["steps"]) else "done"
        )
        entry["undoable"] = entry["status"] == "done" and any(
            s["undoable"] and s["status"] == "done" for s in entry["steps"]
        )
        out.append(entry)
    return out
