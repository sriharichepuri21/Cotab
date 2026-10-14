"""email forwarding: private inbox aliases, allowed senders, inbound log

Adds `users.inbox_alias` (the part before the @ of each person's forwarding
address), `inbox_senders` (extra addresses they forward from) and
`inbound_emails` (every forwarded email and what happened to it, which also
makes processing idempotent).

Revision ID: e9a4c6b1d2f5
Revises: d7f3b2c8e1a4
"""

import sqlalchemy as sa

from alembic import op

revision = "e9a4c6b1d2f5"
down_revision = "d7f3b2c8e1a4"
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("inbox_alias", sa.String(48), nullable=True))
        batch.create_index("ix_users_inbox_alias", ["inbox_alias"], unique=True)

    op.create_table(
        "inbox_senders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "email", name="uq_inbox_sender"),
    )
    op.create_index("ix_inbox_senders_user_id", "inbox_senders", ["user_id"])
    op.create_index("ix_inbox_senders_deleted_at", "inbox_senders", ["deleted_at"])

    op.create_table(
        "inbound_emails",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provider_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("from_address", sa.String(320), nullable=True),
        sa.Column("subject", sa.String(512), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("reason", sa.String(512), nullable=True),
        sa.Column("receipt_id", sa.String(36), nullable=True),
        *_timestamps(),
    )
    op.create_index(
        "ix_inbound_emails_provider_id", "inbound_emails", ["provider_id"], unique=True
    )
    op.create_index("ix_inbound_emails_user_id", "inbound_emails", ["user_id"])
    op.create_index("ix_inbound_emails_deleted_at", "inbound_emails", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_inbound_emails_deleted_at", table_name="inbound_emails")
    op.drop_index("ix_inbound_emails_user_id", table_name="inbound_emails")
    op.drop_index("ix_inbound_emails_provider_id", table_name="inbound_emails")
    op.drop_table("inbound_emails")
    op.drop_index("ix_inbox_senders_deleted_at", table_name="inbox_senders")
    op.drop_index("ix_inbox_senders_user_id", table_name="inbox_senders")
    op.drop_table("inbox_senders")
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_inbox_alias")
        batch.drop_column("inbox_alias")
