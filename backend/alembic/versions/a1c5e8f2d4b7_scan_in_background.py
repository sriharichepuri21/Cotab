"""background scanning: when a read started, and what it found

Revision ID: a1c5e8f2d4b7
Revises: f3b8d1a6c9e2
"""

import sqlalchemy as sa

from alembic import op

revision = "a1c5e8f2d4b7"
down_revision = "f3b8d1a6c9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.add_column(
            sa.Column("reading_since", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(sa.Column("scan_info", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.drop_column("scan_info")
        batch.drop_column("reading_since")
