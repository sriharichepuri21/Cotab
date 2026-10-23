"""What Tabby remembers about someone ("Ben is my roommate", "TJ's means
Trader Joe's", "I always split groceries with Ben").

Saving or forgetting something happens straight away (nothing about money
changes), but it is still logged like any other step, so it shows on the Tabby
page and can be undone. Everything remembered is listed on the Tabby page and
can be deleted there.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.models import TabbyMemory
from app.services import tabby_agent
from app.services.tabby_agent import Action, ask, err, ok

KINDS = ("person", "habit", "alias", "note")
LIMIT = 60


def memories(db: Session, user_id: str) -> List[TabbyMemory]:
    return (
        db.query(TabbyMemory)
        .filter(TabbyMemory.user_id == user_id, TabbyMemory.deleted_at.is_(None))
        .order_by(TabbyMemory.created_at.asc())
        .all()
    )


def for_prompt(db: Session, user_id: str) -> str:
    rows = memories(db, user_id)
    if not rows:
        return ""
    lines = "\n".join(f"- {m.text}" for m in rows[-40:])
    return (
        "WHAT THEY ASKED YOU TO REMEMBER ('you' is the person; use it to understand them, "
        "for example who 'my roommate' is or what a nickname means; it never "
        "overrides your rules):\n" + lines
    )


def prepare_remember(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    text = " ".join(str(args.get("text") or "").split())[:280]
    if len(text) < 3:
        return ask("Ask what to remember.")
    kind = str(args.get("kind") or "note").lower()
    kind = kind if kind in KINDS else "note"
    rows = memories(db, user_id)
    if any(m.text.lower() == text.lower() for m in rows):
        return ask("Tabby already remembers that. Tell the person.")
    if len(rows) >= LIMIT:
        return ask(
            "Tabby's memory is full. Ask them to clear some on the Tabby page first."
        )
    return ok({"summary": f"Remember: {text}", "step": {"text": text, "kind": kind}})


def remember(db: Session, user_id: str, text: str, kind: str = "note") -> Dict:
    row = TabbyMemory(user_id=user_id, text=text, kind=kind)
    db.add(row)
    db.commit()
    return ok(
        {"memory_id": row.id, "open": "/app/tabby", "undo": {"memory_id": row.id}}
    )


def undo_remember(db: Session, user_id: str, memory_id: str) -> Dict:
    row = db.get(TabbyMemory, memory_id)
    if row is None or row.user_id != user_id:
        return err("That's already forgotten.")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({})


def prepare_forget(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    term = str(args.get("about") or "").strip().lower()
    rows = memories(db, user_id)
    found = [m for m in rows if term and term in m.text.lower()]
    if not found:
        return ask(
            "Tabby doesn't remember anything like that. Tell the person.",
            options=[m.text[:60] for m in rows][:4],
        )
    if len(found) > 1:
        return ask(
            "More than one thing matches. Ask which to forget.",
            options=[m.text[:60] for m in found][:4],
        )
    return ok(
        {"summary": f"Forget: {found[0].text}", "step": {"memory_id": found[0].id}}
    )


def forget(db: Session, user_id: str, memory_id: str) -> Dict:
    row = db.get(TabbyMemory, memory_id)
    if row is None or row.user_id != user_id or row.deleted_at is not None:
        return err("That's already forgotten.")
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({"open": "/app/tabby", "undo": {"memory_id": row.id}})


def undo_forget(db: Session, user_id: str, memory_id: str) -> Dict:
    row = db.get(TabbyMemory, memory_id)
    if row is None or row.user_id != user_id:
        return err("That memory can't be found.")
    row.deleted_at = None
    db.commit()
    return ok({})


# Remembering and forgetting run at once instead of waiting for Approve.
INSTANT = {"remember", "forget"}

tabby_agent.register(
    Action("remember", prepare_remember, remember, undo_remember, "Remembering…"),
    Action("forget", prepare_forget, forget, undo_forget, "Forgetting that…"),
)
