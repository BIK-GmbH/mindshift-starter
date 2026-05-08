"""public share tokens for podcast episodes

Revision ID: 0017_episode_shares
Revises: 0016_audio_async_status
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0017_episode_shares"
down_revision: Union[str, None] = "0016_audio_async_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "episode_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "episode_id",
            UUID(as_uuid=True),
            sa.ForeignKey("podcast_episodes.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("token", sa.String(48), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("episode_shares")
