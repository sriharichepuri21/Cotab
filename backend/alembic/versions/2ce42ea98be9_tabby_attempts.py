"""a log of every try at a Tabby step

Revision ID: 2ce42ea98be9
Revises: b4a89d5db80f

Running a step, undoing it, putting it back after a later step failed, and
recovery after a crash each append a row here under the run's id, so one
operation's whole story can be read in order.
"""

import sqlalchemy as sa

from alembic import op

revision = "2ce42ea98be9"
down_revision = "b4a89d5db80f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tabby_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("detail", sa.String(512), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tabby_attempts_user_id", "tabby_attempts", ["user_id"])
    op.create_index(
        "ix_tabby_attempts_run_step", "tabby_attempts", ["run_id", "position"]
    )


def downgrade() -> None:
    op.drop_index("ix_tabby_attempts_run_step", table_name="tabby_attempts")
    op.drop_index("ix_tabby_attempts_user_id", table_name="tabby_attempts")
    op.drop_table("tabby_attempts")
