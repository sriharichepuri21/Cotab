"""email verification codes, and Google / Apple sign-in ids

Revision ID: e7a2c4d9f1b3
Revises: d5f9b3c2e8a1

Accounts that already exist are treated as verified: they signed up before
codes existed and shouldn't be locked out. New accounts start unverified.
"""

import sqlalchemy as sa

from alembic import op

revision = "e7a2c4d9f1b3"
down_revision = "d5f9b3c2e8a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "email_verified", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )
        batch.add_column(sa.Column("verify_code_hash", sa.String(64), nullable=True))
        batch.add_column(
            sa.Column("verify_expires_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "verify_attempts", sa.Integer(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column("verify_sent_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "has_password", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )
        batch.add_column(sa.Column("google_sub", sa.String(255), nullable=True))
        batch.add_column(sa.Column("apple_sub", sa.String(255), nullable=True))
    # From now on the app sets the value for every new row itself.
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email_verified", server_default=None)
        batch.alter_column("verify_attempts", server_default=None)
        batch.alter_column("has_password", server_default=None)
    op.create_index(op.f("ix_users_google_sub"), "users", ["google_sub"], unique=True)
    op.create_index(op.f("ix_users_apple_sub"), "users", ["apple_sub"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_apple_sub"), table_name="users")
    op.drop_index(op.f("ix_users_google_sub"), table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("apple_sub")
        batch.drop_column("google_sub")
        batch.drop_column("has_password")
        batch.drop_column("verify_sent_at")
        batch.drop_column("verify_attempts")
        batch.drop_column("verify_expires_at")
        batch.drop_column("verify_code_hash")
        batch.drop_column("email_verified")
