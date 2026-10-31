"""a payment remembers the tap that recorded it

Revision ID: c03659962232
Revises: 0f65fd187b50

The app sends one key per "paid" tap; a retried request with the same key
from the same person is the same payment, not a second one.
"""

import sqlalchemy as sa

from alembic import op

revision = "c03659962232"
down_revision = "0f65fd187b50"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("settlements") as batch:
        batch.add_column(sa.Column("idempotency_key", sa.String(64), nullable=True))
        batch.create_unique_constraint(
            "uq_settlement_idempotency", ["recorded_by", "idempotency_key"]
        )


def downgrade() -> None:
    with op.batch_alter_table("settlements") as batch:
        batch.drop_constraint("uq_settlement_idempotency", type_="unique")
        batch.drop_column("idempotency_key")
