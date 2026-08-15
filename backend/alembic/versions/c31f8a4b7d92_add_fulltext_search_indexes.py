"""add full-text search indexes (postgres only)

Revision ID: c31f8a4b7d92
Revises: 766645a7e65f
Create Date: 2026-08-15

Search spans merchant names and line-item descriptions. On Postgres that is
backed by GIN indexes over `to_tsvector('english', ...)`.

Two decisions worth recording:

1. Expression indexes, not a stored tsvector column. A materialized column is
   marginally faster to scan but has to be kept in sync with triggers or a
   generated column, which is machinery to maintain and get wrong. The query in
   receipt_query.py computes to_tsvector inline, so an expression index over the
   identical expression is what the planner can actually use.

2. Guarded on dialect. Local dev and the whole test suite run on SQLite, which
   has neither tsvector nor GIN; an unguarded migration would break
   `alembic upgrade head` everywhere except production. SQLite uses the LIKE
   fallback in receipt_query and needs no index at this scale.
"""

from alembic import op

revision = "c31f8a4b7d92"
down_revision = "766645a7e65f"
branch_labels = None
depends_on = None

_MERCHANT_IDX = "ix_receipts_merchant_fts"
_ITEM_IDX = "ix_receipt_line_items_description_fts"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_postgres():
        return  # SQLite: receipt_query falls back to LIKE
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {_MERCHANT_IDX} ON receipts "
        "USING GIN (to_tsvector('english', coalesce(merchant, '')))"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {_ITEM_IDX} ON receipt_line_items "
        "USING GIN (to_tsvector('english', coalesce(description, '')))"
    )


def downgrade() -> None:
    if not _is_postgres():
        return
    op.execute(f"DROP INDEX IF EXISTS {_ITEM_IDX}")
    op.execute(f"DROP INDEX IF EXISTS {_MERCHANT_IDX}")
