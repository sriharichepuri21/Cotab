"""tabby avatar: the outfit, mood and background someone picked

Revision ID: c4e8a1f7b2d9
Revises: b3d7e2a9c4f1
"""

import sqlalchemy as sa

from alembic import op

revision = "c4e8a1f7b2d9"
down_revision = "b3d7e2a9c4f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("avatar_look", sa.String(16), nullable=True))
        batch.add_column(sa.Column("avatar_mood", sa.String(16), nullable=True))
        batch.add_column(sa.Column("avatar_bg", sa.String(8), nullable=True))
        batch.add_column(sa.Column("tabby_reacts", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("tabby_reacts")
        batch.drop_column("avatar_bg")
        batch.drop_column("avatar_mood")
        batch.drop_column("avatar_look")
