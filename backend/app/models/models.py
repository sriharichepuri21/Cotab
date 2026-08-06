import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
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
    # Soft delete: non-null means deleted; rows auto-purge after grace period
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, default="")
    timezone = Column(String, default="UTC")
    telegram_chat_id = Column(String, nullable=True)

    receipts = relationship("Receipt", back_populates="user")
    budgets = relationship("Budget", back_populates="user")


class Receipt(Base, TimestampMixin):
    __tablename__ = "receipts"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), index=True, nullable=False)
    merchant = Column(String, index=True, default="")
    merchant_raw = Column(String, default="")  # as-read from OCR
    purchased_at = Column(DateTime(timezone=True), nullable=True)
    total = Column(Float, default=0.0)
    subtotal = Column(Float, default=0.0)
    tax = Column(Float, default=0.0)
    currency = Column(String, default="USD")
    category = Column(String, default="other")
    # uploaded -> processing -> extracted -> reviewed | failed
    status = Column(String, default="uploaded", index=True)
    image_key = Column(String, default="")  # S3 object key
    confidence = Column(Float, default=0.0)
    error_message = Column(String, default="")

    user = relationship("User", back_populates="receipts")
    line_items = relationship(
        "ReceiptLineItem", back_populates="receipt", cascade="all, delete-orphan"
    )


class ReceiptLineItem(Base, TimestampMixin):
    __tablename__ = "receipt_line_items"

    id = Column(String, primary_key=True, default=_uuid)
    receipt_id = Column(String, ForeignKey("receipts.id"), index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)  # denormalized for scoping
    description = Column(String, default="")
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)

    receipt = relationship("Receipt", back_populates="line_items")


class Budget(Base, TimestampMixin):
    __tablename__ = "budgets"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), index=True, nullable=False)
    category = Column(String, nullable=False)
    monthly_limit = Column(Float, nullable=False)
    alert_thresholds = Column(String, default="50,80,100")  # comma-separated %

    user = relationship("User", back_populates="budgets")


class ChatSession(Base, TimestampMixin):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), index=True, nullable=False)
    title = Column(String, default="New chat")

    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base, TimestampMixin):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=_uuid)
    session_id = Column(
        String, ForeignKey("chat_sessions.id"), index=True, nullable=False
    )
    role = Column(String, nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    sql_used = Column(Text, nullable=True)  # transparency: show the query

    session = relationship("ChatSession", back_populates="messages")


class ExportRequest(Base, TimestampMixin):
    __tablename__ = "export_requests"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), index=True, nullable=False)
    status = Column(String, default="pending")  # pending | ready | expired
    file_key = Column(String, default="")
    expires_at = Column(DateTime(timezone=True), nullable=True)


class ReminderLog(Base, TimestampMixin):
    __tablename__ = "reminder_logs"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, index=True, nullable=False)
    kind = Column(
        String, nullable=False
    )  # weekly_digest | monthly_report | budget_alert
    period_key = Column(String, nullable=False)  # e.g. "2026-W31" — dedupe guard
    channel = Column(String, default="log")  # telegram | email | log
    payload = Column(Text, default="")


class SplitGroup(Base, TimestampMixin):
    __tablename__ = "split_groups"

    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id"), index=True, nullable=False)
    name = Column(String, default="Split")
    share_code = Column(String, unique=True, index=True, default=_uuid)

    members = relationship(
        "SplitMember", back_populates="group", cascade="all, delete-orphan"
    )


class SplitMember(Base, TimestampMixin):
    __tablename__ = "split_members"

    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("split_groups.id"), index=True, nullable=False)
    name = Column(String, nullable=False)  # no account needed
    user_id = Column(String, nullable=True)  # set only if they have an account

    group = relationship("SplitGroup", back_populates="members")


class ReceiptSplit(Base, TimestampMixin):
    __tablename__ = "receipt_splits"

    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("split_groups.id"), index=True, nullable=False)
    receipt_id = Column(String, ForeignKey("receipts.id"), nullable=False)
    paid_by_member_id = Column(String, ForeignKey("split_members.id"), nullable=False)


class SplitShare(Base, TimestampMixin):
    __tablename__ = "split_shares"

    id = Column(String, primary_key=True, default=_uuid)
    split_id = Column(
        String, ForeignKey("receipt_splits.id"), index=True, nullable=False
    )
    member_id = Column(String, ForeignKey("split_members.id"), nullable=False)
    amount = Column(Float, nullable=False)
    settled = Column(Boolean, default=False)
