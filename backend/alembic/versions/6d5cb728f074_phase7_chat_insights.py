"""phase 7 chat proposals, explanations and insights

Revision ID: 6d5cb728f074
Revises: f42a8c19d501
"""

import sqlalchemy as sa

from alembic import op

revision = "6d5cb728f074"
down_revision = "f42a8c19d501"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("tool_trace", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "chat_messages",
        sa.Column("context", sa.Text(), nullable=False, server_default="{}"),
    )
    with op.batch_alter_table("chat_messages") as batch:
        batch.alter_column("tool_trace", server_default=None)
        batch.alter_column("context", server_default=None)
    op.create_table(
        "chat_action_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("chat_sessions.id"),
            nullable=False,
        ),
        sa.Column("tool_name", sa.String(64), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(512), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    for col in ("user_id", "session_id", "status", "expires_at", "deleted_at"):
        op.create_index(
            f"ix_chat_action_proposals_{col}", "chat_action_proposals", [col]
        )
    op.create_table(
        "insights",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("dedupe_key", sa.String(255), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_insight_user_key"),
    )
    for col in ("user_id", "kind", "observed_at", "expires_at", "deleted_at"):
        op.create_index(f"ix_insights_{col}", "insights", [col])


def downgrade() -> None:
    op.drop_table("insights")
    op.drop_table("chat_action_proposals")
    op.drop_column("chat_messages", "context")
    op.drop_column("chat_messages", "tool_trace")
