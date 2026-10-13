"""purchases: the record a receipt attaches to

Creates `purchases`, adds `receipts.purchase_id`, and wraps every existing
receipt in a purchase with the same id, copying its money fields. Soft-deleted
receipts get soft-deleted purchases, so nothing deleted comes back.

Downgrade drops the column and the table; receipts keep all their own data,
so nothing is lost going back.

Revision ID: b8d2f6a1c3e7
Revises: a7c3e91d4b10
"""

import sqlalchemy as sa

from alembic import op

revision = "b8d2f6a1c3e7"
down_revision = "a7c3e91d4b10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "purchases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("merchant", sa.String(255), nullable=True),
        sa.Column("total", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=True),
        sa.Column("category", sa.String(64), nullable=True),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_purchases_user_id", "purchases", ["user_id"])
    op.create_index("ix_purchases_deleted_at", "purchases", ["deleted_at"])

    with op.batch_alter_table("receipts") as batch:
        batch.add_column(sa.Column("purchase_id", sa.String(36), nullable=True))
        batch.create_index("ix_receipts_purchase_id", ["purchase_id"])
        batch.create_foreign_key(
            "fk_receipts_purchase_id", "purchases", ["purchase_id"], ["id"]
        )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO purchases (id, user_id, merchant, total, currency, "
            "category, purchased_at, source, created_at, updated_at, deleted_at) "
            "SELECT id, user_id, COALESCE(merchant, ''), COALESCE(total, 0), "
            "COALESCE(currency, 'USD'), COALESCE(category, 'other'), purchased_at, "
            "'photo', created_at, updated_at, deleted_at FROM receipts"
        )
    )
    bind.execute(sa.text("UPDATE receipts SET purchase_id = id"))


def downgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.drop_constraint("fk_receipts_purchase_id", type_="foreignkey")
        batch.drop_index("ix_receipts_purchase_id")
        batch.drop_column("purchase_id")
    op.drop_index("ix_purchases_deleted_at", table_name="purchases")
    op.drop_index("ix_purchases_user_id", table_name="purchases")
    op.drop_table("purchases")
