"""a settlement remembers its currency

Revision ID: e7a9c1b3d5f8
Revises: b5d7f9a1c3e4

Existing payments get their tab's main currency: the one most of its
receipts are in, USD on a tie (split_service.primary_currency).
"""

from collections import defaultdict

import sqlalchemy as sa

from alembic import op

revision = "e7a9c1b3d5f8"
down_revision = "b5d7f9a1c3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("settlements") as batch:
        batch.add_column(sa.Column("currency", sa.String(3), nullable=True))

    bind = op.get_bind()
    counts = defaultdict(lambda: defaultdict(int))
    for group_id, currency, n in bind.execute(
        sa.text(
            "SELECT s.group_id, r.currency, COUNT(*) FROM receipt_splits s "
            "JOIN receipts r ON r.id = s.receipt_id "
            "WHERE s.deleted_at IS NULL GROUP BY s.group_id, r.currency"
        )
    ):
        counts[group_id][currency or "USD"] += n
    for (group_id,) in bind.execute(
        sa.text("SELECT DISTINCT group_id FROM settlements")
    ).all():
        found = counts.get(group_id) or {}
        main = max(found, key=lambda c: (found[c], c == "USD")) if found else "USD"
        bind.execute(
            sa.text("UPDATE settlements SET currency = :c WHERE group_id = :g"),
            {"c": main, "g": group_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("settlements") as batch:
        batch.drop_column("currency")
