"""social post image versions async fields

Revision ID: 651c7fda0495
Revises: 3c28db6104a0
Create Date: 2026-05-11 14:02:46.234993

Adds status / error_message + makes file_id nullable so we can
persist a "processing" version *before* gpt-image-2 returns and let
a BackgroundTask flip it to ready/failed when done.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "651c7fda0495"
down_revision: Union[str, None] = "3c28db6104a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "card_social_post_image_versions",
        "file_id",
        existing_type=UUID(as_uuid=True),
        nullable=True,
    )
    op.add_column(
        "card_social_post_image_versions",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="ready",
            index=True,
        ),
    )
    op.add_column(
        "card_social_post_image_versions",
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.execute("UPDATE card_social_post_image_versions SET status = 'ready'")
    op.alter_column(
        "card_social_post_image_versions",
        "status",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_column("card_social_post_image_versions", "error_message")
    op.drop_column("card_social_post_image_versions", "status")
    op.alter_column(
        "card_social_post_image_versions",
        "file_id",
        existing_type=UUID(as_uuid=True),
        nullable=False,
    )
