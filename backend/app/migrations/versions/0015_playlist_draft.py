"""persist generated podcast script draft on playlist

Revision ID: 0015_playlist_draft
Revises: 0014_podcast_playlists
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_playlist_draft"
down_revision: Union[str, None] = "0014_podcast_playlists"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "podcast_playlists",
        sa.Column("draft_title", sa.String(200), nullable=True),
    )
    op.add_column(
        "podcast_playlists",
        sa.Column("draft_narrative_text", sa.Text, nullable=True),
    )
    op.add_column(
        "podcast_playlists",
        sa.Column(
            "draft_target_minutes", sa.Integer, nullable=True, server_default=None
        ),
    )


def downgrade() -> None:
    op.drop_column("podcast_playlists", "draft_target_minutes")
    op.drop_column("podcast_playlists", "draft_narrative_text")
    op.drop_column("podcast_playlists", "draft_title")
