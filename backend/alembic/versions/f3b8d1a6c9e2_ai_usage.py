"""ai usage log: one row per AI call with tokens and estimated cost

Feeds the daily spending caps (per person and for the whole app) and the
usage report.

Revision ID: f3b8d1a6c9e2
Revises: e9a4c6b1d2f5
"""

import sqlalchemy as sa

from alembic import op

revision = "f3b8d1a6c9e2"
down_revision = "e9a4c6b1d2f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("feature", sa.String(16), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=False),
    )
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"])
    op.create_index("ix_ai_usage_user_id", "ai_usage", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_user_id", table_name="ai_usage")
    op.drop_index("ix_ai_usage_created_at", table_name="ai_usage")
    op.drop_table("ai_usage")
