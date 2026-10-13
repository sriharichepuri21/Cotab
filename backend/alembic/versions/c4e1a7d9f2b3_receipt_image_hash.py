"""receipts.image_sha256: fingerprint of the uploaded file

Lets the upload endpoint refuse the exact same photo or PDF a second time.
Existing receipts keep a null fingerprint; nothing is backfilled because the
stored images were re-encoded and would not match a fresh upload anyway.

Revision ID: c4e1a7d9f2b3
Revises: b8d2f6a1c3e7
"""

import sqlalchemy as sa

from alembic import op

revision = "c4e1a7d9f2b3"
down_revision = "b8d2f6a1c3e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.add_column(sa.Column("image_sha256", sa.String(64), nullable=True))
        batch.create_index("ix_receipts_image_sha256", ["image_sha256"])


def downgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.drop_index("ix_receipts_image_sha256")
        batch.drop_column("image_sha256")
