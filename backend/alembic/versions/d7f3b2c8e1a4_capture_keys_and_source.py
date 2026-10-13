"""capture keys for Apple Pay taps, and where each receipt came from

Adds `capture_keys` (private keys for the tap shortcut, stored as SHA-256
fingerprints) and `receipts.source` (photo | pdf | tap | email). Existing
receipts are marked "pdf" when their stored file is a PDF and "photo"
otherwise.

Revision ID: d7f3b2c8e1a4
Revises: c4e1a7d9f2b3
"""

import sqlalchemy as sa

from alembic import op

revision = "d7f3b2c8e1a4"
down_revision = "c4e1a7d9f2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capture_keys",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(64), nullable=True),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("prefix", sa.String(12), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_capture_keys_user_id", "capture_keys", ["user_id"])
    op.create_index(
        "ix_capture_keys_key_hash", "capture_keys", ["key_hash"], unique=True
    )
    op.create_index("ix_capture_keys_deleted_at", "capture_keys", ["deleted_at"])

    with op.batch_alter_table("receipts") as batch:
        batch.add_column(
            sa.Column("source", sa.String(16), nullable=False, server_default="photo")
        )
    op.execute("UPDATE receipts SET source = 'pdf' WHERE lower(image_key) LIKE '%.pdf'")


def downgrade() -> None:
    with op.batch_alter_table("receipts") as batch:
        batch.drop_column("source")
    op.drop_index("ix_capture_keys_deleted_at", table_name="capture_keys")
    op.drop_index("ix_capture_keys_key_hash", table_name="capture_keys")
    op.drop_index("ix_capture_keys_user_id", table_name="capture_keys")
    op.drop_table("capture_keys")
