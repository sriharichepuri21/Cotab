"""add receipts.extraction_method

Revision ID: 766645a7e65f
Revises: ba0b47dd332c
Create Date: 2026-08-09 23:21:17.466470

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "766645a7e65f"
down_revision: Union[str, None] = "ba0b47dd332c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add nullable first so the ALTER works on SQLite (can't add a NOT NULL
    # column without a default), then backfill existing rows to "gemini"
    # (everything predating Phase 2 was Gemini-extracted). The Python-side
    # default lives on the ORM model (default="gemini") for new rows; SQLite
    # can't ALTER COLUMN to change a default, so the value is app-owned.
    op.add_column(
        "receipts", sa.Column("extraction_method", sa.String(length=16), nullable=True)
    )
    op.execute(
        "UPDATE receipts SET extraction_method='gemini' WHERE extraction_method IS NULL"
    )


def downgrade() -> None:
    op.drop_column("receipts", "extraction_method")
