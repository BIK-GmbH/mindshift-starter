"""add card_social_posts table

Revision ID: ca1736b289ef
Revises: fc1f3cb59725
Create Date: 2026-05-11 11:10:10.776729

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'ca1736b289ef'
down_revision: Union[str, None] = 'fc1f3cb59725'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_social_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("platform", sa.String(24), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("hashtags", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("character_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "image_file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("tone", sa.String(40), nullable=True),
        sa.Column("language", sa.String(40), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_card_social_posts_card_id", "card_social_posts", ["card_id"])


def downgrade() -> None:
    op.drop_index("ix_card_social_posts_card_id", table_name="card_social_posts")
    op.drop_table("card_social_posts")
