"""card translations (per-language title + summaries)

Revision ID: 0018_card_translations
Revises: 0017_episode_shares
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0018_card_translations"
down_revision: Union[str, None] = "0017_episode_shares"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_translations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("language", sa.String(40), nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("concise_summary_md", sa.Text, nullable=True),
        sa.Column("detailed_summary_md", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="ready",
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "card_id", "language", name="uq_card_translations_card_lang"
        ),
    )
    op.create_index(
        "ix_card_translations_card_id", "card_translations", ["card_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_card_translations_card_id", table_name="card_translations"
    )
    op.drop_table("card_translations")
