"""add youtube_suggestion_cache

Revision ID: c1d8e9f2a401
Revises: b7c91d4f3201
Create Date: 2026-05-12 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c1d8e9f2a401"
down_revision: Union[str, None] = "b7c91d4f3201"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "youtube_suggestion_cache",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scope", sa.String(length=40), nullable=False),
        sa.Column("scope_key", sa.String(length=255), nullable=False),
        sa.Column("query", sa.String(length=500), nullable=False),
        sa.Column("results_json", sa.JSON(), nullable=False),
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
        sa.UniqueConstraint("user_id", "scope", "scope_key", name="uq_yt_cache_user_scope"),
    )
    op.create_index(
        "ix_youtube_suggestion_cache_user_id",
        "youtube_suggestion_cache",
        ["user_id"],
    )
    op.create_index(
        "ix_youtube_suggestion_cache_scope",
        "youtube_suggestion_cache",
        ["scope"],
    )


def downgrade() -> None:
    op.drop_index("ix_youtube_suggestion_cache_scope", table_name="youtube_suggestion_cache")
    op.drop_index("ix_youtube_suggestion_cache_user_id", table_name="youtube_suggestion_cache")
    op.drop_table("youtube_suggestion_cache")
