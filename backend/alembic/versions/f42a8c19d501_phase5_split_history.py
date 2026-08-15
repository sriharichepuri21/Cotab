"""phase 5 split history and allocation metadata

Revision ID: f42a8c19d501
Revises: e5b71c9a3f04
"""

import sqlalchemy as sa

from alembic import op

revision = "f42a8c19d501"
down_revision = "e5b71c9a3f04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "split_members", sa.Column("email", sa.String(length=320), nullable=True)
    )
    op.add_column(
        "receipt_splits",
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="even"),
    )
    op.add_column(
        "receipt_splits",
        sa.Column(
            "tax_mode", sa.String(length=16), nullable=False, server_default="pro_rata"
        ),
    )
    # Defaults only backfill existing rows. Runtime owns new values, matching
    # the ORM and preventing Alembic from detecting permanent schema drift.
    with op.batch_alter_table("receipt_splits") as batch:
        batch.alter_column("mode", server_default=None)
        batch.alter_column("tax_mode", server_default=None)
    op.create_table(
        "split_item_assignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("split_id", sa.String(length=36), nullable=False),
        sa.Column("line_item_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["line_item_id"], ["receipt_line_items.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["split_members.id"]),
        sa.ForeignKeyConstraint(["split_id"], ["receipt_splits.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "split_id", "line_item_id", "member_id", name="uq_split_item_assignment"
        ),
    )
    for column in ("deleted_at", "line_item_id", "split_id"):
        op.create_index(
            op.f(f"ix_split_item_assignments_{column}"),
            "split_item_assignments",
            [column],
            unique=False,
        )


def downgrade() -> None:
    for column in ("split_id", "line_item_id", "deleted_at"):
        op.drop_index(
            op.f(f"ix_split_item_assignments_{column}"),
            table_name="split_item_assignments",
        )
    op.drop_table("split_item_assignments")
    op.drop_column("receipt_splits", "tax_mode")
    op.drop_column("receipt_splits", "mode")
    op.drop_column("split_members", "email")
