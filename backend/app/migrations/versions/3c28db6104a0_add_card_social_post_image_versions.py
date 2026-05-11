"""add card social post image versions

Revision ID: 3c28db6104a0
Revises: 0a7a8b7a1ead
Create Date: 2026-05-11 13:40:06.625525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "3c28db6104a0"
down_revision: Union[str, None] = "0a7a8b7a1ead"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_social_post_image_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "post_id",
            UUID(as_uuid=True),
            sa.ForeignKey("card_social_posts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Whatever instruction produced this version. The original
        # generation stores the resolved template prompt; refine steps
        # store the user's natural-language refinement ("remove the
        # sources line, shorten the headline"). Capped at 4 KB so a
        # 100-version run can't bloat the row.
        sa.Column("prompt_used", sa.Text(), nullable=True),
        # 'generate' for fresh outputs, 'refine' for images.edit() runs.
        # Lets the UI render a different icon per version.
        sa.Column("kind", sa.String(20), nullable=False, server_default="generate"),
        # Self-FK pointing to the version this one was derived from
        # (refine chain). NULL for the very first generation.
        sa.Column(
            "parent_version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("card_social_post_image_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("card_social_post_image_versions")
