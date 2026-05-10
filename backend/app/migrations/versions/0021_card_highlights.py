"""card_highlights table — quotes saved from any web page

Revision ID: 0021_card_highlights
Revises: 0020_user_preferences
Create Date: 2026-05-10

Phase 5 of the extension roadmap. Enables the user to highlight text
on any web page and persist it as a quote attached to the matching
card. The prefix/suffix anchor strings let us re-locate the quote on
a later visit when DOM offsets have drifted.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0021_card_highlights"
down_revision: Union[str, None] = "0020_user_preferences"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_highlights",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_url", sa.Text, nullable=False),
        sa.Column("anchor_text", sa.Text, nullable=False),
        sa.Column("prefix", sa.Text, nullable=False, server_default=""),
        sa.Column("suffix", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "color", sa.String(16), nullable=False, server_default="yellow"
        ),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_card_highlights_user_url",
        "card_highlights",
        ["user_id", "source_url"],
    )
    op.create_index(
        "ix_card_highlights_card",
        "card_highlights",
        ["card_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_card_highlights_card", table_name="card_highlights")
    op.drop_index("ix_card_highlights_user_url", table_name="card_highlights")
    op.drop_table("card_highlights")
