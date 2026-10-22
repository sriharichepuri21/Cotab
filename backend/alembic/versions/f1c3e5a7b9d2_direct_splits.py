"""direct splits: split straight with people, no group name

Revision ID: f1c3e5a7b9d2
Revises: e7a2c4d9f1b3
"""

import sqlalchemy as sa

from alembic import op

revision = "f1c3e5a7b9d2"
down_revision = "e7a2c4d9f1b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("split_groups") as batch:
        batch.add_column(
            sa.Column("kind", sa.String(16), nullable=False, server_default="group")
        )
    with op.batch_alter_table("split_groups") as batch:
        batch.alter_column("kind", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("split_groups") as batch:
        batch.drop_column("kind")
