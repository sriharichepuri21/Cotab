"""push notifications: devices that allow them, and the server's own keys

Revision ID: b6e8f0a2c4d7
Revises: a3d5f7b9c1e4
"""

import sqlalchemy as sa

from alembic import op

revision = "b6e8f0a2c4d7"
down_revision = "a3d5f7b9c1e4"
branch_labels = None
depends_on = None


def _stamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("endpoint_hash", sa.String(64), nullable=False),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    op.create_index(
        "ix_push_subscriptions_endpoint_hash",
        "push_subscriptions",
        ["endpoint_hash"],
        unique=True,
    )
    op.create_index(
        "ix_push_subscriptions_deleted_at", "push_subscriptions", ["deleted_at"]
    )
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        *_stamps(),
    )
    op.create_index("ix_app_settings_deleted_at", "app_settings", ["deleted_at"])


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("push_subscriptions")
