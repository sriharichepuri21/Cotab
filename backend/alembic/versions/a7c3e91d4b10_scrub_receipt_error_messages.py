"""scrub raw exception text from receipts.error_message

Before this revision a failed extraction stored `str(exception)` in
receipts.error_message, which the API returns to the browser. Provider and
database errors can contain internal details, so replace any stored text on
failed receipts with the same friendly message new failures now get.

Data-only; no schema change. Downgrade is a no-op because the original text
is intentionally not kept.

Revision ID: a7c3e91d4b10
Revises: 6d5cb728f074
"""

import sqlalchemy as sa

from alembic import op

revision = "a7c3e91d4b10"
down_revision = "6d5cb728f074"
branch_labels = None
depends_on = None

FRIENDLY = "We couldn't read this receipt. Try retrying, or enter the details by hand."


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE receipts SET error_message = :msg "
            "WHERE error_message IS NOT NULL AND error_message != ''"
        ),
        {"msg": FRIENDLY},
    )


def downgrade() -> None:
    pass
