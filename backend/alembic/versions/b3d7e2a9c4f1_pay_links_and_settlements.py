"""pay links and settlements: where to pay people, and payments made

Revision ID: b3d7e2a9c4f1
Revises: a1c5e8f2d4b7
"""

import sqlalchemy as sa

from alembic import op

revision = "b3d7e2a9c4f1"
down_revision = "a1c5e8f2d4b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("pay_handles", sa.Text(), nullable=True))
    with op.batch_alter_table("split_members") as batch:
        batch.add_column(sa.Column("pay_handles", sa.Text(), nullable=True))
    op.create_table(
        "settlements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "group_id", sa.String(36), sa.ForeignKey("split_groups.id"), nullable=False
        ),
        sa.Column(
            "from_member_id",
            sa.String(36),
            sa.ForeignKey("split_members.id"),
            nullable=False,
        ),
        sa.Column(
            "to_member_id",
            sa.String(36),
            sa.ForeignKey("split_members.id"),
            nullable=False,
        ),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("recorded_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_settlements_group_id", "settlements", ["group_id"])
    op.create_index("ix_settlements_deleted_at", "settlements", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_settlements_deleted_at", table_name="settlements")
    op.drop_index("ix_settlements_group_id", table_name="settlements")
    op.drop_table("settlements")
    with op.batch_alter_table("split_members") as batch:
        batch.drop_column("pay_handles")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("pay_handles")
