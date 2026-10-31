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

Crash safety (see `run`):

- Every step of a run is written down, as `pending`, before anything happens,
  keyed by (run_id, position). A second tap or a resumed request finds those
  rows and never does a finished step again.
- A step's change and the row that says it's done are committed together, in
  one database transaction. If the server stops mid-step, both roll back and
  the step is simply `pending`/`running` again: safe to run.
- A step that reaches outside the app (a push to a friend's phone) can't be
  rolled back with the database. If one stops part-way it becomes
  `interrupted`: Tabby doesn't send it again, and the person is told.
- An undo that fails is not hidden: the step becomes `undo_failed`, the run
  says it needs attention, the operator is alerted, and Undo can be tried again.
- Every try at a step (running it, undoing it, putting it back, recovery) is
  appended to `tabby_attempts` under the run's id, written as `started`
  before it begins. `history()` reads one operation's whole story in order,
  including tries a crash cut off.
"""

from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterator, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import TabbyActivity, TabbyAttempt
from app.services import ops_alerts

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
    # True when the step does something the database can't take back with a
    # rollback (a push notification). Such a step is never run twice.
    external: bool = False


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


# --- running a plan ------------------------------------------------------------------

# Statuses that mean the person (or the operator) has to look at the step.
ATTENTION = ("undo_failed", "interrupted")
# A step left `running` this long is assumed to belong to a request that died.
STALE_AFTER = timedelta(minutes=10)


def _checkpoint(name: str) -> None:
    """Where tests inject a crash: after_claim, after_execute, after_commit."""


@contextmanager
def _one_transaction(db: Session) -> Iterator[None]:
    """Hold an action's own commits back, so that its change and the activity
    row saying it's done are committed together, or not at all.

    Actions call `db.commit()` themselves (they're also used outside plans);
    inside here that only flushes, and the caller commits once at the end.
    """
    db.commit = db.flush  # type: ignore[method-assign]
    try:
        yield
    finally:
        del db.commit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _rows(db: Session, user_id: str, run_id: str) -> Dict[int, TabbyActivity]:
    rows = (
        db.query(TabbyActivity)
        .filter(
            TabbyActivity.user_id == user_id,
            TabbyActivity.run_id == run_id,
            TabbyActivity.deleted_at.is_(None),
        )
        .all()
    )
    return {row.position: row for row in rows}


def _write_down(
    db: Session,
    user_id: str,
    run_id: str,
    steps: List[Dict[str, Any]],
    source: str,
) -> Optional[Dict[int, TabbyActivity]]:
    """Make sure every step of the run has its row, `pending` until it runs.
    None when another request is writing the same run right now."""
    rows = _rows(db, user_id, run_id)
    for position, step in enumerate(steps):
        if position in rows:
            continue
        db.add(
            TabbyActivity(
                user_id=user_id,
                run_id=run_id,
                position=position,
                action=step["action"],
                summary=step["summary"][:512],
                status="pending",
                source=source,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return _rows(db, user_id, run_id)


def _claim(db: Session, row: TabbyActivity, expected: str) -> Optional[TabbyAttempt]:
    """Move one step to `running`, only if it is still `expected`. Two requests
    can race for the same step; the database lets exactly one of them win.
    The winner's try is logged, as `started`, in the same commit."""
    won = (
        db.query(TabbyActivity)
        .filter(TabbyActivity.id == row.id, TabbyActivity.status == expected)
        .update(
            {"status": "running", "detail": None, "updated_at": _now()},
            synchronize_session=False,
        )
    )
    attempt = None
    if won:
        if expected == "running":  # taking over from a request that died
            _close_open(db, row, "abandoned", "The process running it stopped.")
        attempt = _attempt(db, row, "execute")
    db.commit()
    db.refresh(row)
    return attempt


# --- the attempt log ------------------------------------------------------------------


def _attempt(
    db: Session,
    row: TabbyActivity,
    kind: str,
    outcome: str = "started",
    detail: Optional[str] = None,
) -> TabbyAttempt:
    """Append one try at this step. Committed by the caller."""
    attempt = TabbyAttempt(
        user_id=row.user_id,
        run_id=row.run_id,
        position=row.position,
        action=row.action,
        kind=kind,
        outcome=outcome,
        detail=(detail or "")[:512] or None,
        started_at=_now(),
        finished_at=None if outcome == "started" else _now(),
    )
    db.add(attempt)
    return attempt


def _close(attempt: TabbyAttempt, outcome: str, detail: Optional[str] = None) -> None:
    attempt.outcome = outcome
    attempt.detail = (str(detail) if detail else "")[:512] or None
    attempt.finished_at = _now()


def _close_open(db: Session, row: TabbyActivity, outcome: str, detail: str) -> None:
    """Close tries a crash left open on this step."""
    for attempt in (
        db.query(TabbyAttempt)
        .filter(
            TabbyAttempt.run_id == row.run_id,
            TabbyAttempt.position == row.position,
            TabbyAttempt.outcome == "started",
        )
        .all()
    ):
        _close(attempt, outcome, detail)


def history(
    db: Session, run_id: str, user_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Everything that happened to one operation, oldest first: each try at
    each step, how it ended, and why. Without user_id (operators only) any
    run can be read."""
    query = db.query(TabbyAttempt).filter(TabbyAttempt.run_id == run_id)
    if user_id is not None:
        query = query.filter(TabbyAttempt.user_id == user_id)
    return [
        {
            "position": a.position,
            "action": a.action,
            "kind": a.kind,
            "outcome": a.outcome,
            "detail": a.detail,
            "started_at": iso(a.started_at),
            "finished_at": iso(a.finished_at),
        }
        for a in query.order_by(
            TabbyAttempt.started_at.asc(), TabbyAttempt.position.asc()
        ).all()
    ]


def _step_result(row: TabbyActivity, data: Optional[Dict[str, Any]] = None) -> Dict:
    return {
        "summary": row.summary,
        "open": (data or {}).get("open", row.open_path),
        "undoable": row.undo is not None,
    }


def _busy() -> Dict[str, Any]:
    """Another request is running this same run right now: leave it alone."""
    return {
        "status": "error",
        "hint": "Tabby is already working on this. Give it a moment.",
        "busy": True,
    }


def _attention_error(hint: str) -> Dict[str, Any]:
    return {"status": "error", "hint": hint, "needs_attention": True}


def run(
    db: Session,
    user_id: str,
    steps: List[Dict[str, Any]],
    run_id: Optional[str] = None,
    source: str = "chat",
) -> Dict[str, Any]:
    """Carry out an approved plan, step by step. All or nothing.

    Safe to call again with the same run_id (a second tap, or after a crash):
    finished steps are skipped, and a step another request is running now is
    left alone.
    """
    _load()
    run_id = run_id or str(uuid.uuid4())
    rows = _write_down(db, user_id, run_id, steps, source)
    if rows is None:
        return _busy()
    done: List[TabbyActivity] = []
    results: List[Dict[str, Any]] = []
    extra: Dict[str, Any] = {}
    for position, step in enumerate(steps):
        row = rows[position]
        action = ACTIONS.get(step["action"])
        if row.status == "done":
            # A retry reached a step that's already done: noted, not repeated.
            _attempt(db, row, "execute", "skipped", "Already done.")
            db.commit()
            done.append(row)
            results.append(_step_result(row))
            continue
        if row.status in ATTENTION:
            return _attention_error(
                f"Step {position + 1} ({row.summary}) needs checking: "
                f"{row.detail or 'it stopped part-way'}. See Tabby's activity."
            )
        if row.status == "running":
            stale = _aware(row.updated_at) or _now()
            if _now() - stale < STALE_AFTER:
                return _busy()
            if action is not None and action.external:
                # It may or may not have reached the friend's phone: never
                # send it twice, and say so.
                _mark_interrupted(db, row)
                return _attention_error(
                    f"Step {position + 1} ({row.summary}) was interrupted and may "
                    "or may not have happened. Nothing will be sent twice."
                )
            # Its change rolled back with the request that died: run it again.
            expected = "running"
        else:
            expected = row.status  # pending, failed or rolled_back: run (again)
        attempt = _claim(db, row, expected)
        if attempt is None:
            return _busy()
        _checkpoint("after_claim")
        result = _execute(db, user_id, row, action, step, attempt)
        if result.get("status") != "ok":
            hint = result.get("hint", "unknown problem")
            problems = _compensate(db, user_id, done)
            if problems:
                ops_alerts.alert(
                    "tabby_rollback_failed",
                    f"Run {run_id} (user {user_id}): step {position + 1} failed "
                    f"({hint}) and putting back earlier steps failed: "
                    + "; ".join(problems)
                    + f". History: GET /api/v1/admin/tabby/runs/{run_id}",
                    key=run_id,
                )
                return _attention_error(
                    f"Step {position + 1} ({step['summary']}) couldn't be done: {hint}. "
                    f"Tabby also couldn't put back: {'; '.join(problems)}. "
                    "It's marked on Tabby's activity so you can try Undo again."
                )
            return {
                "status": "error",
                "hint": f"Step {position + 1} ({step['summary']}) couldn't be done: "
                f"{hint}. Nothing was changed.",
            }
        _checkpoint("after_commit")
        data = result.get("data") or {}
        extra.update({k: data[k] for k in ("tab", "group_id") if k in data})
        done.append(row)
        results.append(_step_result(row, data))
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


def _execute(
    db: Session,
    user_id: str,
    row: TabbyActivity,
    action: Optional[Action],
    step: Dict[str, Any],
    attempt: TabbyAttempt,
) -> Dict[str, Any]:
    """Run one step: its change, its `done` row and its logged try commit
    together."""
    try:
        with _one_transaction(db):
            result = (
                action.execute(db, user_id, **step["step"])
                if action
                else err("Unknown action.")
            )
            if result.get("status") == "ok":
                data = result.get("data") or {}
                row.status = "done"
                row.detail = None
                row.undo = (
                    json.dumps(data["undo"]) if data.get("undo") is not None else None
                )
                row.open_path = data.get("open")
                _close(attempt, "ok")
                db.flush()
                _checkpoint("after_execute")
        if result.get("status") == "ok":
            db.commit()
            return result
        db.rollback()
    except Exception:
        logger.exception("Step %s failed", step["action"])
        db.rollback()
        result = err("Something went wrong on that step.")
    db.refresh(row)
    db.refresh(attempt)
    row.status = "failed"
    row.detail = str(result.get("hint") or "")[:512] or None
    _close(attempt, "failed", row.detail)
    db.commit()
    return result


def _compensate(db: Session, user_id: str, done: List[TabbyActivity]) -> List[str]:
    """Put back the steps already done, last first. Returns what couldn't be."""
    problems = []
    for row in reversed(done):
        if row.undo is None:
            problems.append(f"{row.summary} (this can't be undone)")
            continue
        result = _undo_row(db, user_id, row, rolled_back=True)
        if result.get("status") != "ok":
            problems.append(f"{row.summary} ({result.get('hint', 'undo failed')})")
    return problems


def _mark_interrupted(db: Session, row: TabbyActivity) -> None:
    row.status = "interrupted"
    row.detail = "Stopped part-way; it may or may not have happened."
    _close_open(db, row, "interrupted", row.detail)
    db.commit()
    ops_alerts.alert(
        "tabby_step_interrupted",
        f"Run {row.run_id} (user {row.user_id}): step {row.position + 1} "
        f"'{row.summary}' ({row.action}) was interrupted part-way. "
        f"History: GET /api/v1/admin/tabby/runs/{row.run_id}",
        key=row.id,
    )


def _undo_row(
    db: Session, user_id: str, row: TabbyActivity, rolled_back: bool = False
) -> Dict[str, Any]:
    """Undo one step. Its change and its new status commit together; a failed
    undo is recorded as `undo_failed`, never passed off as undone."""
    action = ACTIONS.get(row.action)
    if row.status not in ("done", "undo_failed"):
        return ok({"already": True})
    if action is None or action.undo is None or row.undo is None:
        return err("This step can't be undone.")
    # Logged before it begins, so an undo a crash cuts off is still on record.
    attempt = _attempt(db, row, "rollback" if rolled_back else "undo")
    db.commit()
    try:
        with _one_transaction(db):
            result = action.undo(db, user_id, **json.loads(row.undo))
            if result.get("status") == "ok":
                row.status = "rolled_back" if rolled_back else "undone"
                row.detail = None
                row.undone_at = _now()
                _close(attempt, "ok")
                db.flush()
        if result.get("status") == "ok":
            db.commit()
            return result
        db.rollback()
    except Exception:
        logger.exception("Undoing %s failed", row.action)
        db.rollback()
        result = err("Undo failed.")
    db.refresh(row)
    db.refresh(attempt)
    row.status = "undo_failed"
    row.detail = str(result.get("hint") or "Undo failed.")[:512]
    _close(attempt, "failed", row.detail)
    db.commit()
    ops_alerts.alert(
        "tabby_undo_failed",
        f"Run {row.run_id} (user {user_id}): undoing step {row.position + 1} "
        f"'{row.summary}' ({row.action}) failed: {row.detail}. "
        f"History: GET /api/v1/admin/tabby/runs/{row.run_id}",
        key=row.id,
    )
    return result


def undo_run(db: Session, user_id: str, run_id: str) -> Dict[str, Any]:
    """Undo every step of a run, last first. Steps whose undo failed before
    are tried again."""
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
    if any(row.status in ("pending", "running") for row in rows):
        return err("Tabby is still working on this. Try again in a moment.")
    problems = []
    undone = 0
    for row in rows:
        if row.status not in ("done", "undo_failed"):
            continue
        result = _undo_row(db, user_id, row)
        if result.get("status") != "ok":
            problems.append(f"{row.summary}: {result.get('hint')}")
        else:
            undone += 1
    if problems:
        return err(" ".join(problems))
    return ok({"run_id": run_id, "undone": undone})


def recover_stale(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    """Finish off runs whose request died part-way (a deploy, a crash).

    Steps that were never started, or whose change rolled back with the dead
    request, are marked failed; steps already done in that run are put back,
    so nothing is left half-done. An outside step (a push) that was running is
    marked interrupted and the operator alerted. Called at start-up and daily.
    """
    _load()
    now = now or _now()
    cutoff = now - STALE_AFTER
    stuck = (
        db.query(TabbyActivity)
        .filter(
            TabbyActivity.status.in_(("pending", "running")),
            TabbyActivity.deleted_at.is_(None),
        )
        .all()
    )
    runs = sorted(
        {
            (row.user_id, row.run_id)
            for row in stuck
            if (_aware(row.updated_at) or now) < cutoff
        }
    )
    counts = {"runs": 0, "interrupted": 0, "rolled_back": 0, "needs_attention": 0}
    for user_id, run_id in runs:
        rows = _rows(db, user_id, run_id)
        counts["runs"] += 1
        for row in rows.values():
            if row.status == "running":
                action = ACTIONS.get(row.action)
                if action is not None and action.external:
                    _mark_interrupted(db, row)
                    counts["interrupted"] += 1
                    continue
            if row.status in ("pending", "running"):
                if row.status == "running":
                    _close_open(db, row, "abandoned", "The process running it stopped.")
                row.status = "failed"
                row.detail = "Stopped before it finished; nothing was changed."
                _attempt(db, row, "recover", "failed", row.detail)
                db.commit()
        done = [rows[p] for p in sorted(rows) if rows[p].status == "done"]
        problems = _compensate(db, user_id, done)
        counts["rolled_back"] += len(done)
        if problems:
            counts["needs_attention"] += 1
            ops_alerts.alert(
                "tabby_recovery_failed",
                f"Run {run_id} (user {user_id}) stopped part-way and couldn't be "
                "fully put back: "
                + "; ".join(problems)
                + f". History: GET /api/v1/admin/tabby/runs/{run_id}",
                key=run_id,
            )
        _release_proposal(db, run_id, needs_attention=bool(problems))
    return counts


def _release_proposal(db: Session, run_id: str, needs_attention: bool) -> None:
    """A chat plan whose run was cleaned up can be approved again (or, if it
    couldn't be fully put back, is held for the person to check)."""
    from app.models import ChatActionProposal

    row = db.get(ChatActionProposal, run_id)
    if row is not None and row.status == "executing":
        row.status = "needs_attention" if needs_attention else "pending"
        db.commit()


def activity(db: Session, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Recent runs, newest first, each with its steps.

    A run that failed and was cleanly put back changed nothing, so it isn't
    listed. A run with a step whose undo failed, or that was interrupted, is
    listed as needing attention.
    """
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
                "detail": row.detail,
                "open": row.open_path,
                "undoable": row.undo is not None,
            }
        )
    out = []
    for entry in runs.values():
        steps = entry["steps"]
        steps.sort(key=lambda s: s["position"])
        statuses = {s["status"] for s in steps}
        if statuses <= {"failed", "rolled_back"}:
            continue  # tried, didn't happen, nothing left behind
        if statuses & set(ATTENTION):
            entry["status"] = "needs_attention"
        elif statuses & {"pending", "running"}:
            entry["status"] = "working"
        elif statuses <= {"undone", "failed", "rolled_back"}:
            entry["status"] = "undone"
        else:
            entry["status"] = "done"
        entry["undoable"] = entry["status"] in ("done", "needs_attention") and any(
            s["undoable"] and s["status"] in ("done", "undo_failed") for s in steps
        )
        out.append(entry)
        if len(out) >= limit:
            break
    return out
