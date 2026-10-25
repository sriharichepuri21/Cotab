"""fee, tip, tax and discount lines lose their price-history keys

They aren't products, so "Delivery fee went up 12%" was never real. New lines
get no key (price_memory.item_key); this clears the ones saved before.

Revision ID: b4d6f8a0c2e3
Revises: a3c5e7f9b1d2
"""

import re

import sqlalchemy as sa

from alembic import op

revision = "b4d6f8a0c2e3"
down_revision = "a3c5e7f9b1d2"
branch_labels = None
depends_on = None

# The rule as of this migration (app/utils/receipt_lines.py), kept here so a
# later change to it doesn't change what this one-time clean-up did.
CHARGE = re.compile(
    r"\b(fees?|tip|gratuity|tax(es)?|discounts?|promo(tion)?s?|coupons?|"
    r"savings?|credits?|surcharges?)\b",
    re.IGNORECASE,
)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, description, total_price FROM receipt_line_items "
            "WHERE item_key IS NOT NULL AND item_code IS NULL"
        )
    )
    charges = [
        row.id
        for row in rows
        if (row.total_price or 0) < 0 or CHARGE.search(row.description or "")
    ]
    lines = sa.table("receipt_line_items", sa.column("id"), sa.column("item_key"))
    for start in range(0, len(charges), 500):
        bind.execute(
            lines.update()
            .where(lines.c.id.in_(charges[start : start + 500]))
            .values(item_key=None)
        )


def downgrade() -> None:
    pass  # the keys were never real price history; nothing to put back
