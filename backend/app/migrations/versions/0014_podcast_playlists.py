"""podcast playlists, ordered cards, generated episodes

Revision ID: 0014_podcast_playlists
Revises: 0013_card_audio
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0014_podcast_playlists"
down_revision: Union[str, None] = "0013_card_audio"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "podcast_playlists",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_podcast_playlists_user_id", "podcast_playlists", ["user_id"])

    op.create_table(
        "podcast_playlist_cards",
        sa.Column(
            "playlist_id",
            UUID(as_uuid=True),
            sa.ForeignKey("podcast_playlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer, nullable=False),
        sa.PrimaryKeyConstraint("playlist_id", "card_id"),
    )
    op.create_index(
        "ix_podcast_playlist_cards_playlist_pos",
        "podcast_playlist_cards",
        ["playlist_id", "position"],
    )

    op.create_table(
        "podcast_episodes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "playlist_id",
            UUID(as_uuid=True),
            sa.ForeignKey("podcast_playlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("narrative_text", sa.Text, nullable=False),
        sa.Column("voice", sa.String(40), nullable=False, server_default="Kore"),
        sa.Column(
            "audio_file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "cover_file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_podcast_episodes_playlist_id", "podcast_episodes", ["playlist_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_podcast_episodes_playlist_id", table_name="podcast_episodes")
    op.drop_table("podcast_episodes")
    op.drop_index(
        "ix_podcast_playlist_cards_playlist_pos", table_name="podcast_playlist_cards"
    )
    op.drop_table("podcast_playlist_cards")
    op.drop_index("ix_podcast_playlists_user_id", table_name="podcast_playlists")
    op.drop_table("podcast_playlists")
