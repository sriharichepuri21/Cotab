"""Tabby steps are idempotent and say why they failed

Revision ID: 0f65fd187b50
Revises: e7a9c1b3d5f8

Each step of a run is now written before it runs, keyed by (run_id, position),
so a retry finds the step instead of doing it twice. `detail` holds why a step
failed, couldn't be undone, or was interrupted.
"""

import sqlalchemy as sa

from alembic import op

revision = "0f65fd187b50"
down_revision = "e7a9c1b3d5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tabby_activity") as batch:
        batch.add_column(sa.Column("detail", sa.String(512), nullable=True))
        batch.create_unique_constraint(
            "uq_tabby_activity_run_step", ["run_id", "position"]
        )


def downgrade() -> None:
    with op.batch_alter_table("tabby_activity") as batch:
        batch.drop_constraint("uq_tabby_activity_run_step", type_="unique")
        batch.drop_column("detail")
