"""Your own settings Tabby can change: your name, your Tabby picture, whether
Tabby reacts to new receipts, and where friends can pay you."""

from __future__ import annotations

import typing
from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models import User
from app.schemas.auth import AvatarLook, AvatarMood
from app.services import pay_links, tabby_agent
from app.services.tabby_agent import Action, ask, ok

LOOKS = typing.get_args(AvatarLook)
MOODS = typing.get_args(AvatarMood)
APPS = {
    "venmo": "Venmo",
    "paypal": "PayPal",
    "cashapp": "Cash App",
    "cash app": "Cash App",
    "zelle": "Zelle",
}
FIELDS = ("full_name", "avatar_look", "avatar_mood", "tabby_reacts")


def prepare_profile(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    user = db.get(User, user_id)
    changes: Dict[str, Any] = {}
    said = []
    name = str(args.get("name") or "").strip()[:255]
    if name and name != user.full_name:
        changes["full_name"] = name
        said.append(f"your name to {name}")
    look = str(args.get("tabby_outfit") or "").strip().lower()
    if look:
        if look not in LOOKS:
            return ask("Ask which outfit.", options=list(LOOKS))
        changes["avatar_look"] = look
        said.append(f"your Tabby's outfit to {look}")
    mood = str(args.get("tabby_mood") or "").strip().lower()
    if mood:
        if mood not in MOODS:
            return ask("Ask which face.", options=list(MOODS)[:4])
        changes["avatar_mood"] = mood
        said.append(f"your Tabby's face to {mood}")
    reacts = args.get("tabby_reacts")
    if reacts is not None and bool(reacts) != bool(user.tabby_reacts is not False):
        changes["tabby_reacts"] = bool(reacts)
        said.append("Tabby's reactions to new receipts " + ("on" if reacts else "off"))
    if not changes:
        return ask("Nothing would change. Ask what to change.")
    return ok({"summary": f"Change {', '.join(said)}.", "step": {"changes": changes}})


def update_profile(db: Session, user_id: str, changes: Dict[str, Any]) -> Dict:
    user = db.get(User, user_id)
    before = {k: getattr(user, k) for k in changes if k in FIELDS}
    for key, value in changes.items():
        if key in FIELDS:
            setattr(user, key, value)
    db.commit()
    return ok({"open": "/app/settings", "undo": {"before": before}})


def undo_profile(db: Session, user_id: str, before: Dict[str, Any]) -> Dict:
    user = db.get(User, user_id)
    for key, value in before.items():
        if key in FIELDS:
            setattr(user, key, value)
    db.commit()
    return ok({})


def prepare_pay(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    app = str(args.get("app") or "").strip().lower()
    method = {"cash app": "cashapp"}.get(app, app)
    if method not in pay_links.METHODS:
        return ask("Ask which app.", options=["Venmo", "PayPal", "Cash App", "Zelle"])
    handle = str(args.get("handle") or "").strip()
    user = db.get(User, user_id)
    current = pay_links.load(user.pay_handles)
    if not handle:
        if method not in current:
            return ask(f"No {APPS[app]} saved. Tell the person.")
        return ok(
            {
                "summary": f"Remove your {APPS[app]} ({current[method]}).",
                "step": {"method": method, "handle": ""},
            }
        )
    try:
        cleaned = pay_links.clean_handles({method: handle})[method]
    except pay_links.HandleError as problem:
        return ask(f"{problem}. Ask them to check it.")
    return ok(
        {
            "summary": f"Save {cleaned} as your {APPS[app]}, so friends can pay you "
            "with one tap.",
            "step": {"method": method, "handle": cleaned},
        }
    )


def set_pay_handle(db: Session, user_id: str, method: str, handle: str) -> Dict:
    user = db.get(User, user_id)
    current = pay_links.load(user.pay_handles)
    before = current.get(method)
    if handle:
        current[method] = handle
    else:
        current.pop(method, None)
    user.pay_handles = pay_links.dump(current)
    db.commit()
    return ok({"open": "/app/settings", "undo": {"method": method, "before": before}})


def undo_pay(db: Session, user_id: str, method: str, before=None) -> Dict:
    user = db.get(User, user_id)
    current = pay_links.load(user.pay_handles)
    if before:
        current[method] = before
    else:
        current.pop(method, None)
    user.pay_handles = pay_links.dump(current)
    db.commit()
    return ok({})


tabby_agent.register(
    Action(
        "update_profile", prepare_profile, update_profile, undo_profile, "Updating…"
    ),
    Action("set_pay_handle", prepare_pay, set_pay_handle, undo_pay, "Updating…"),
)
