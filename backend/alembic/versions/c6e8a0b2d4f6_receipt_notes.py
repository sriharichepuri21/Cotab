"""receipts get a note (for expenses added by hand)

Revision ID: c6e8a0b2d4f6
Revises: b4d6f8a0c2e3
"""

import sqlalchemy as sa

from alembic import op

revision = "c6e8a0b2d4f6"
down_revision = "b4d6f8a0c2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.add_column(sa.Column("note", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.drop_column("note")
