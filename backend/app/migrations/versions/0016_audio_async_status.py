"""async generation status on card_audio + podcast_episodes

Revision ID: 0016_audio_async_status
Revises: 0015_playlist_draft
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_audio_async_status"
down_revision: Union[str, None] = "0015_playlist_draft"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "card_audio",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="ready",
        ),
    )
    op.add_column("card_audio", sa.Column("error_message", sa.Text, nullable=True))

    op.add_column(
        "podcast_episodes",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="ready",
        ),
    )
    op.add_column(
        "podcast_episodes", sa.Column("error_message", sa.Text, nullable=True)
    )


def downgrade() -> None:
    op.drop_column("podcast_episodes", "error_message")
    op.drop_column("podcast_episodes", "status")
    op.drop_column("card_audio", "error_message")
    op.drop_column("card_audio", "status")
