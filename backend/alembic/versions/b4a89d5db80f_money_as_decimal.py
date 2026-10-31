"""money is stored as exact decimals

Revision ID: b4a89d5db80f
Revises: c03659962232

Amounts were FLOAT, which can't hold most cent values exactly (0.10 is
0.1000000000000000055...). They become NUMERIC: two decimal places for
totals, tax, shares, payments and budgets; four for a line's unit price
(fuel and by-weight prices go past cents). Existing values are rounded to
those places on the way.
"""

import sqlalchemy as sa

from alembic import op

revision = "b4a89d5db80f"
down_revision = "c03659962232"
branch_labels = None
depends_on = None

COLUMNS = [
    ("purchases", "total", 2, True),
    ("receipts", "total", 2, True),
    ("receipts", "subtotal", 2, True),
    ("receipts", "tax", 2, True),
    ("receipt_line_items", "unit_price", 4, True),
    ("receipt_line_items", "total_price", 2, True),
    ("budgets", "amount", 2, False),
    ("split_shares", "amount", 2, False),
    ("settlements", "amount", 2, False),
]


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    for table, column, places, nullable in COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                column,
                existing_type=sa.Float(),
                type_=sa.Numeric(14, places),
                existing_nullable=nullable,
                postgresql_using=f"round({column}::numeric, {places})",
            )
        if sqlite:  # no USING clause there: round what's stored instead
            op.execute(f"UPDATE {table} SET {column} = round({column}, {places})")


def downgrade() -> None:
    for table, column, places, nullable in COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                column,
                existing_type=sa.Numeric(14, places),
                type_=sa.Float(),
                existing_nullable=nullable,
                postgresql_using=f"{column}::double precision",
            )
