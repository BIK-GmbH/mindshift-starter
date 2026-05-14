"""add channel_subscriptions, channel_videos, channel_video_pop_cache

Merges the two existing heads (youtube_suggestion_cache and
path_quiz_attempts) before adding the YouTube-channel subscription
tables.

Revision ID: d4e8c2a1b9f3
Revises: c1d8e9f2a401, 61e67a85908c
Create Date: 2026-05-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d4e8c2a1b9f3"
down_revision: Union[str, Sequence[str], None] = ("c1d8e9f2a401", "61e67a85908c")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "channel_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel_id", sa.String(length=40), nullable=False),
        sa.Column("handle", sa.String(length=120), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("thumbnail_url", sa.String(length=2048), nullable=True),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("subscriber_count", sa.Integer(), nullable=True),
        sa.Column(
            "ingest_mode",
            sa.String(length=16),
            nullable=False,
            server_default="manual",
        ),
        sa.Column(
            "exclude_shorts",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("last_etag", sa.String(length=255), nullable=True),
        sa.Column("last_modified", sa.String(length=255), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column(
            "items_ingested",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
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
        sa.UniqueConstraint(
            "user_id", "channel_id", name="uq_channel_subs_user_channel"
        ),
    )
    op.create_index(
        "ix_channel_subscriptions_user_id",
        "channel_subscriptions",
        ["user_id"],
    )
    op.create_index(
        "ix_channel_subscriptions_channel_id",
        "channel_subscriptions",
        ["channel_id"],
    )

    op.create_table(
        "channel_videos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "subscription_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("channel_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("video_id", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("thumbnail_url", sa.String(length=2048), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_short",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "saved_card_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "discovered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "subscription_id", "video_id", name="uq_channel_videos_sub_vid"
        ),
    )
    op.create_index(
        "ix_channel_videos_subscription_id",
        "channel_videos",
        ["subscription_id"],
    )
    op.create_index(
        "ix_channel_videos_published_at",
        "channel_videos",
        ["published_at"],
    )

    op.create_table(
        "channel_video_pop_cache",
        sa.Column(
            "subscription_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("channel_subscriptions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("channel_video_pop_cache")
    op.drop_index("ix_channel_videos_published_at", table_name="channel_videos")
    op.drop_index(
        "ix_channel_videos_subscription_id", table_name="channel_videos"
    )
    op.drop_table("channel_videos")
    op.drop_index(
        "ix_channel_subscriptions_channel_id", table_name="channel_subscriptions"
    )
    op.drop_index(
        "ix_channel_subscriptions_user_id", table_name="channel_subscriptions"
    )
    op.drop_table("channel_subscriptions")
