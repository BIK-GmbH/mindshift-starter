"""add source column to tags

Revision ID: 112a16b2363b
Revises: d4e8c2a1b9f3
Create Date: 2026-05-15 16:11:33.270842

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '112a16b2363b'
down_revision: Union[str, None] = 'd4e8c2a1b9f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Track whether a tag was AI-suggested during ingestion or explicitly
    # created by the user. Auto-cleanup of orphaned tags after card-delete
    # only touches 'ai' rows, so manually-created "empty drawer" tags
    # survive.
    op.add_column(
        "tags",
        sa.Column(
            "source",
            sa.String(length=8),
            nullable=False,
            server_default="ai",
        ),
    )


def downgrade() -> None:
    op.drop_column("tags", "source")
