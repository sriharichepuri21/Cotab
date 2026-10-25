"""what was typed for exact / percent / shares splits

Revision ID: b5d7f9a1c3e4
Revises: a3c5e7f9b1d2
"""

import sqlalchemy as sa

from alembic import op

revision = "b5d7f9a1c3e4"
down_revision = "a3c5e7f9b1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipt_splits") as batch:
        batch.add_column(sa.Column("parts", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("receipt_splits") as batch:
        batch.drop_column("parts")
