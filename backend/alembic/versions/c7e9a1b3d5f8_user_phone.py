"""user phone numbers: how friends find each other

Revision ID: c7e9a1b3d5f8
Revises: b6e8f0a2c4d7
"""

import sqlalchemy as sa

from alembic import op

revision = "c7e9a1b3d5f8"
down_revision = "b6e8f0a2c4d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("phone", sa.String(16), nullable=True))
        batch.add_column(
            sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True)
        )
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_phone", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("phone_verified_at")
        batch.drop_column("phone")
