"""Tabby agent: what Tabby did (with undo), what it remembers, its rules

Revision ID: a3d5f7b9c1e4
Revises: f1c3e5a7b9d2
"""

import sqlalchemy as sa

from alembic import op

revision = "a3d5f7b9c1e4"
down_revision = "f1c3e5a7b9d2"
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
        "tabby_activity",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("summary", sa.String(512), nullable=False),
        sa.Column("undo", sa.Text(), nullable=True),
        sa.Column("open_path", sa.String(255), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="done"),
        sa.Column("source", sa.String(16), nullable=False, server_default="chat"),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_tabby_activity_user_id", "tabby_activity", ["user_id"])
    op.create_index("ix_tabby_activity_run_id", "tabby_activity", ["run_id"])
    op.create_index("ix_tabby_activity_deleted_at", "tabby_activity", ["deleted_at"])

    op.create_table(
        "tabby_memories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="note"),
        sa.Column("text", sa.String(280), nullable=False),
        *_stamps(),
    )
    op.create_index("ix_tabby_memories_user_id", "tabby_memories", ["user_id"])
    op.create_index("ix_tabby_memories_deleted_at", "tabby_memories", ["deleted_at"])

    op.create_table(
        "tabby_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("store", sa.String(128), nullable=True),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("params", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_tabby_rules_user_id", "tabby_rules", ["user_id"])
    op.create_index("ix_tabby_rules_deleted_at", "tabby_rules", ["deleted_at"])


def downgrade() -> None:
    op.drop_table("tabby_rules")
    op.drop_table("tabby_memories")
    op.drop_table("tabby_activity")
