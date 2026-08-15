"""add saved_views

Revision ID: d8ceac844fb2
Revises: c31f8a4b7d92
Create Date: 2026-08-14 18:47:55.911793

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8ceac844fb2"
down_revision: Union[str, None] = "c31f8a4b7d92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also emitted an alter_column dropping a server_default on
    # receipts.extraction_method. That default exists only in the local dev DB,
    # where the column was once added outside Alembic; a database built from
    # these migrations does not have it (verified with `alembic check` against a
    # fresh scratch DB). Shipping it would alter production for no reason, so it
    # is deliberately removed here.
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("filters", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_views_user_name"),
    )
    op.create_index(
        op.f("ix_saved_views_deleted_at"), "saved_views", ["deleted_at"], unique=False
    )
    op.create_index(
        op.f("ix_saved_views_user_id"), "saved_views", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_saved_views_user_id"), table_name="saved_views")
    op.drop_index(op.f("ix_saved_views_deleted_at"), table_name="saved_views")
    op.drop_table("saved_views")
    # ### end Alembic commands ###
