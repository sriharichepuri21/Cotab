"""Account deletion.

Deleting an account soft-deletes the user and everything they own in one
transaction, and immediately scrubs personal details from the user row:

- The email is replaced with a unique placeholder, so the person can sign up
  again with the same address and the old address no longer identifies them.
- The password hash is replaced, so the account can never be signed in to.
- Owned split groups are soft-deleted, which also revokes their public share
  links (the public endpoint already ignores deleted groups).
- In groups they joined but don't own, they stay as a name (so friends'
  balances still add up) but are unlinked from the account, and their
  payment handles are removed.

Rows keep `deleted_at` for the SOFT_DELETE_GRACE_DAYS window like every other
delete in the app. Hard-purging rows and stored receipt images after that
window is a separate scheduled job.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import (
    AIUsage,
    Budget,
    CaptureKey,
    ChatActionProposal,
    ChatMessage,
    ChatSession,
    ExportRequest,
    InboundEmail,
    InboxSender,
    Insight,
    Purchase,
    Receipt,
    ReceiptLineItem,
    SavedView,
    SplitGroup,
    SplitMember,
    User,
)

# Not a valid bcrypt hash, so verify_password can never match it.
_UNUSABLE_PASSWORD = "!deleted"

# Tables with a direct user_id column that belong solely to the user.
_USER_OWNED = (
    CaptureKey,
    InboxSender,  # a deleted account's forwarding stops accepting mail
    InboundEmail,  # a deleted account's tap shortcut must stop working at once
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

    db.query(SplitMember).filter(SplitMember.user_id == user.id).update(
        {SplitMember.user_id: None, SplitMember.pay_handles: None},
        synchronize_session=False,
    )

    # AI usage stays in the totals, but no longer points at this person.
    db.query(AIUsage).filter(AIUsage.user_id == user.id).update(
        {AIUsage.user_id: None}, synchronize_session=False
    )

    user.email = deleted_email_for(user.id)
    user.full_name = ""
    # Free the number so whoever has it next can sign up with it.
    user.phone = None
    user.phone_verified_at = None
    user.telegram_chat_id = None
    user.inbox_alias = None  # the forwarding address stops resolving to anyone
    user.pay_handles = None
    # Free the Google / Apple link so the same person can sign up again later.
    user.google_sub = None
    user.apple_sub = None
    user.verify_code_hash = None
    user.hashed_password = _UNUSABLE_PASSWORD
    user.deleted_at = now
    db.commit()
