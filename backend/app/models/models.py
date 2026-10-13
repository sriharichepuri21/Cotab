import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.session import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    # Soft delete: non-null means deleted; rows auto-purge after grace period.
    # Indexed because every query in the app filters `deleted_at IS NULL`.
    # Declarative copies mixin columns per subclass, so each table gets its own
    # ix_<table>_deleted_at — the names do not collide.
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


# Explicit lengths on String columns and named indexes keep Alembic autogenerate
# deterministic across dialects (some require lengths; renames read well).


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(String(320), unique=True, index=True, nullable=False)
    hashed_password = Column(String(60), nullable=False)
    full_name = Column(String(255), default="")
    timezone = Column(String(64), default="UTC")
    telegram_chat_id = Column(String(64), nullable=True)
    # Onboarding answer: personal | splits | business. Null until the user picks,
    # which is how the frontend knows to show /welcome instead of the home page.
    intent = Column(String(32), nullable=True)

    receipts = relationship("Receipt", back_populates="user")
    budgets = relationship("Budget", back_populates="user")


class Purchase(Base, TimestampMixin):
    """One thing a user bought, however Cotab learned about it.

    A purchase can exist without a receipt (an Apple Pay tap, a card charge) and
    can collect several pieces of evidence (a card charge, an emailed receipt and
    a photo of the same shop). Receipts attach to a purchase via
    `receipts.purchase_id`. Every receipt made before this table existed was
    wrapped in a purchase with the same id by migration b8d2f6a1c3e7.
    """

    __tablename__ = "purchases"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    merchant = Column(String(255), default="")
    total = Column(Float, default=0.0)
    currency = Column(String(3), default="USD")
    category = Column(String(64), default="other")
    purchased_at = Column(DateTime(timezone=True), nullable=True)
    # photo | email | tap | card | manual: how the purchase first arrived.
    source = Column(String(16), default="photo")

    receipts = relationship("Receipt", back_populates="purchase")


class Receipt(Base, TimestampMixin):
    __tablename__ = "receipts"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    purchase_id = Column(
        String(36), ForeignKey("purchases.id"), index=True, nullable=True
    )
    merchant = Column(String(255), index=True, default="")
    merchant_raw = Column(String(255), default="")  # as-read from OCR
    purchased_at = Column(DateTime(timezone=True), nullable=True)
    total = Column(Float, default=0.0)
    subtotal = Column(Float, default=0.0)
    tax = Column(Float, default=0.0)
    currency = Column(String(3), default="USD")
    category = Column(String(64), default="other")
    # uploaded -> processing -> extracted -> reviewed | failed
    status = Column(String(32), default="uploaded", index=True)
    image_key = Column(String(512), default="")  # S3 object key
    # SHA-256 of the uploaded file, so the exact same photo or PDF can't be
    # added twice. Null for receipts from before this was recorded.
    image_sha256 = Column(String(64), nullable=True, index=True)
    confidence = Column(Float, default=0.0)
    error_message = Column(String(1024), default="")
    # Which extractor produced the row: "ocr" (rules) | "gemini" (LLM fallback).
    # Recorded so we can measure how much Gemini we actually save in prod.
    extraction_method = Column(String(16), default="gemini")

    user = relationship("User", back_populates="receipts")
    purchase = relationship("Purchase", back_populates="receipts")
    # selectin: when a list of receipts loads, all their line items arrive in
    # ONE extra query instead of one query per receipt. Against a remote
    # Postgres that was the difference between ~2 and ~50 round trips for a
    # 47-receipt list, growing with every receipt.
    line_items = relationship(
        "ReceiptLineItem",
        back_populates="receipt",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ReceiptLineItem(Base, TimestampMixin):
    __tablename__ = "receipt_line_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    receipt_id = Column(
        String(36), ForeignKey("receipts.id"), index=True, nullable=False
    )
    user_id = Column(String(36), index=True, nullable=False)  # denormalized for scoping
    description = Column(String(512), default="")
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)

    receipt = relationship("Receipt", back_populates="line_items")


class Budget(Base, TimestampMixin):
    """A spending limit at one of four levels, over one of three periods.

    `target` is what `level` points at: a category name, a merchant substring,
    or an item-description substring. For level="total" it is unused (empty), so
    the pair is read as "the whole of `level`, filtered by `target`".

    The column is `amount`, not `monthly_limit`: once weekly and yearly periods
    exist, a field named "monthly" is a lie on two thirds of the rows.
    """

    __tablename__ = "budgets"
    __table_args__ = (
        # One budget per (level, target, period). Re-saving the same combination
        # updates it rather than stacking silent duplicates that each fire their
        # own alert.
        UniqueConstraint(
            "user_id", "level", "target", "period", name="uq_budgets_user_scope"
        ),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    level = Column(String(16), nullable=False, default="category")
    target = Column(String(128), nullable=False, default="")
    period = Column(String(16), nullable=False, default="monthly")
    amount = Column(Float, nullable=False)
    alert_thresholds = Column(String(64), default="80,100,120")  # comma-separated %

    user = relationship("User", back_populates="budgets")


class ChatSession(Base, TimestampMixin):
    __tablename__ = "chat_sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    title = Column(String(255), default="New chat")

    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base, TimestampMixin):
    __tablename__ = "chat_messages"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(
        String(36), ForeignKey("chat_sessions.id"), index=True, nullable=False
    )
    role = Column(String(16), nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    sql_used = Column(Text, nullable=True)  # transparency: show the query
    tool_trace = Column(Text, nullable=False, default="[]")
    context = Column(Text, nullable=False, default="{}")

    session = relationship("ChatSession", back_populates="messages")


class ChatActionProposal(Base, TimestampMixin):
    """User-confirmed boundary for any mutation suggested by chat."""

    __tablename__ = "chat_action_proposals"
    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    session_id = Column(
        String(36), ForeignKey("chat_sessions.id"), index=True, nullable=False
    )
    tool_name = Column(String(64), nullable=False)
    payload = Column(Text, nullable=False)
    summary = Column(String(512), nullable=False)
    status = Column(String(24), index=True, nullable=False, default="pending")
    expires_at = Column(DateTime(timezone=True), index=True, nullable=False)
    executed_at = Column(DateTime(timezone=True), nullable=True)


class Insight(Base, TimestampMixin):
    __tablename__ = "insights"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_insight_user_key"),
    )
    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    kind = Column(String(32), index=True, nullable=False)
    dedupe_key = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    data = Column(Text, nullable=False, default="{}")
    severity = Column(String(16), nullable=False, default="info")
    observed_at = Column(DateTime(timezone=True), index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), index=True, nullable=False)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)


class ExportRequest(Base, TimestampMixin):
    __tablename__ = "export_requests"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    status = Column(String(16), default="pending")  # pending | ready | expired
    file_key = Column(String(512), default="")
    expires_at = Column(DateTime(timezone=True), nullable=True)


class ReminderLog(Base, TimestampMixin):
    __tablename__ = "reminder_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), index=True, nullable=False)
    kind = Column(
        String(32), nullable=False
    )  # weekly_digest | monthly_report | budget_alert
    period_key = Column(String(32), nullable=False)  # e.g. "2026-W31" — dedupe guard
    channel = Column(String(16), default="log")  # telegram | email | log
    payload = Column(Text, default="")


class SplitGroup(Base, TimestampMixin):
    __tablename__ = "split_groups"

    id = Column(String(36), primary_key=True, default=_uuid)
    owner_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    name = Column(String(255), default="Split")
    share_code = Column(String(36), unique=True, index=True, default=_uuid)

    members = relationship(
        "SplitMember", back_populates="group", cascade="all, delete-orphan"
    )


class SplitMember(Base, TimestampMixin):
    __tablename__ = "split_members"

    id = Column(String(36), primary_key=True, default=_uuid)
    group_id = Column(
        String(36), ForeignKey("split_groups.id"), index=True, nullable=False
    )
    name = Column(String(255), nullable=False)  # no account needed
    email = Column(String(320), nullable=True)
    user_id = Column(String(36), nullable=True)  # set only if they have an account

    group = relationship("SplitGroup", back_populates="members")


class ReceiptSplit(Base, TimestampMixin):
    __tablename__ = "receipt_splits"

    id = Column(String(36), primary_key=True, default=_uuid)
    group_id = Column(
        String(36), ForeignKey("split_groups.id"), index=True, nullable=False
    )
    receipt_id = Column(String(36), ForeignKey("receipts.id"), nullable=False)
    paid_by_member_id = Column(
        String(36), ForeignKey("split_members.id"), nullable=False
    )
    mode = Column(String(16), default="even", nullable=False)
    tax_mode = Column(String(16), default="pro_rata", nullable=False)


class SplitShare(Base, TimestampMixin):
    __tablename__ = "split_shares"

    id = Column(String(36), primary_key=True, default=_uuid)
    split_id = Column(
        String(36), ForeignKey("receipt_splits.id"), index=True, nullable=False
    )
    member_id = Column(String(36), ForeignKey("split_members.id"), nullable=False)
    amount = Column(Float, nullable=False)
    settled = Column(Boolean, default=False)


class SplitItemAssignment(Base, TimestampMixin):
    """A persisted item-to-member assignment; duplicate item rows mean sharing."""

    __tablename__ = "split_item_assignments"
    __table_args__ = (
        UniqueConstraint(
            "split_id", "line_item_id", "member_id", name="uq_split_item_assignment"
        ),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    split_id = Column(
        String(36), ForeignKey("receipt_splits.id"), index=True, nullable=False
    )
    line_item_id = Column(
        String(36), ForeignKey("receipt_line_items.id"), index=True, nullable=False
    )
    member_id = Column(String(36), ForeignKey("split_members.id"), nullable=False)


class SavedView(Base, TimestampMixin):
    """A named filter combination on the receipts list ("Coffee this month").

    `filters` holds the query-param set as JSON text rather than a column per
    filter: the filter surface is still moving, and a schema migration every time
    a filter is added would be friction for no benefit. It is opaque to the DB —
    only the frontend interprets it — so Text is honest about that.
    """

    __tablename__ = "saved_views"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_saved_views_user_name"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    name = Column(String(80), nullable=False)
    filters = Column(Text, nullable=False, default="{}")
