"""price memory: product codes, names, sizes and a matching key on receipt lines

Revision ID: d5f9b3c2e8a1
Revises: c4e8a1f7b2d9

Lines already on people's tabs get a key and a size from their printed text,
so price memory works on past receipts the day it ships.
"""

import sqlalchemy as sa

from alembic import op

revision = "d5f9b3c2e8a1"
down_revision = "c4e8a1f7b2d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipt_line_items") as batch:
        batch.add_column(sa.Column("item_code", sa.String(32), nullable=True))
        batch.add_column(sa.Column("item_name", sa.String(255), nullable=True))
        batch.add_column(sa.Column("size_qty", sa.Float(), nullable=True))
        batch.add_column(sa.Column("size_unit", sa.String(8), nullable=True))
        batch.add_column(sa.Column("item_key", sa.String(160), nullable=True))
    op.create_index(
        op.f("ix_receipt_line_items_item_key"),
        "receipt_line_items",
        ["item_key"],
        unique=False,
    )

    # Backfill from the printed text. Imported here so the migration keeps
    # working if the module moves; the parsing is pure and needs no session.
    from app.services.price_memory import line_fields

    conn = op.get_bind()
    lines = sa.table(
        "receipt_line_items",
        sa.column("id", sa.String),
        sa.column("description", sa.String),
        sa.column("size_qty", sa.Float),
        sa.column("size_unit", sa.String),
        sa.column("item_key", sa.String),
    )
    rows = conn.execute(sa.select(lines.c.id, lines.c.description)).fetchall()
    for row_id, description in rows:
        fields = line_fields(description or "")
        conn.execute(
            lines.update()
            .where(lines.c.id == row_id)
            .values(
                item_key=fields["item_key"],
                size_qty=fields["size_qty"],
                size_unit=fields["size_unit"],
            )
        )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_receipt_line_items_item_key"), table_name="receipt_line_items"
    )
    with op.batch_alter_table("receipt_line_items") as batch:
        batch.drop_column("item_key")
        batch.drop_column("size_unit")
        batch.drop_column("size_qty")
        batch.drop_column("item_name")
        batch.drop_column("item_code")
