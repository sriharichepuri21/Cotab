"""budgets and saved views are unique among live rows only

A deleted budget or view kept its slot, so making the same one again failed
(500, "Failed to fetch" in the app).

Revision ID: a3c5e7f9b1d2
Revises: d8f1b3c5e7a9
"""

import sqlalchemy as sa

from alembic import op

revision = "a3c5e7f9b1d2"
down_revision = "d8f1b3c5e7a9"
branch_labels = None
depends_on = None

LIVE = sa.text("deleted_at IS NULL")
RULES = (
    ("budgets", "uq_budgets_user_scope", ["user_id", "level", "target", "period"]),
    ("saved_views", "uq_saved_views_user_name", ["user_id", "name"]),
)


def upgrade() -> None:
    for table, name, columns in RULES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name, type_="unique")
        op.create_index(
            name, table, columns, unique=True, postgresql_where=LIVE, sqlite_where=LIVE
        )


def downgrade() -> None:
    for table, name, columns in RULES:
        op.drop_index(name, table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.create_unique_constraint(name, columns)
