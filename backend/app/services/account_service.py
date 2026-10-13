"""Account deletion.

Deleting an account soft-deletes the user and everything they own in one
transaction, and immediately scrubs personal details from the user row:

- The email is replaced with a unique placeholder, so the person can sign up
  again with the same address and the old address no longer identifies them.
- The password hash is replaced, so the account can never be signed in to.
- Owned split groups are soft-deleted, which also revokes their public share
  links (the public endpoint already ignores deleted groups).

Rows keep `deleted_at` for the SOFT_DELETE_GRACE_DAYS window like every other
delete in the app. Hard-purging rows and stored receipt images after that
window is a separate scheduled job.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import (
    Budget,
    CaptureKey,
    ChatActionProposal,
    ChatMessage,
    ChatSession,
    ExportRequest,
    Insight,
    Purchase,
    Receipt,
    ReceiptLineItem,
    SavedView,
    SplitGroup,
    User,
)

# Not a valid bcrypt hash, so verify_password can never match it.
_UNUSABLE_PASSWORD = "!deleted"

# Tables with a direct user_id column that belong solely to the user.
_USER_OWNED = (
    CaptureKey,  # a deleted account's tap shortcut must stop working at once
    Purchase,
    Receipt,
    ReceiptLineItem,
    Budget,
    ChatSession,
    ChatActionProposal,
    Insight,
    ExportRequest,
    SavedView,
)


def deleted_email_for(user_id: str) -> str:
    return f"deleted-{user_id}@deleted.invalid"


def delete_account(db: Session, user: User) -> None:
    now = datetime.now(timezone.utc)

    for model in _USER_OWNED:
        db.query(model).filter(
            model.user_id == user.id, model.deleted_at.is_(None)
        ).update({model.deleted_at: now}, synchronize_session=False)

    session_ids = db.query(ChatSession.id).filter(ChatSession.user_id == user.id)
    db.query(ChatMessage).filter(
        ChatMessage.session_id.in_(session_ids), ChatMessage.deleted_at.is_(None)
    ).update({ChatMessage.deleted_at: now}, synchronize_session=False)

    db.query(SplitGroup).filter(
        SplitGroup.owner_id == user.id, SplitGroup.deleted_at.is_(None)
    ).update({SplitGroup.deleted_at: now}, synchronize_session=False)

    user.email = deleted_email_for(user.id)
    user.full_name = ""
    user.telegram_chat_id = None
    user.hashed_password = _UNUSABLE_PASSWORD
    user.deleted_at = now
    db.commit()
