"""add is_public to podcast_playlists

Revision ID: cec27e8dc3ab
Revises: 0021_card_highlights
Create Date: 2026-05-11 00:43:09.898411

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cec27e8dc3ab'
down_revision: Union[str, None] = '0021_card_highlights'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "podcast_playlists",
        sa.Column(
            "is_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("podcast_playlists", "is_public")
