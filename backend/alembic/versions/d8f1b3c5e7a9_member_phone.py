"""people on tabs get a phone number

Revision ID: d8f1b3c5e7a9
Revises: c7e9a1b3d5f8
"""

import sqlalchemy as sa

from alembic import op

revision = "d8f1b3c5e7a9"
down_revision = "c7e9a1b3d5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("split_members") as batch:
        batch.add_column(sa.Column("phone", sa.String(16), nullable=True))
    op.create_index("ix_split_members_phone", "split_members", ["phone"])


def downgrade() -> None:
    op.drop_index("ix_split_members_phone", table_name="split_members")
    with op.batch_alter_table("split_members") as batch:
        batch.drop_column("phone")
