"""tag hierarchy via parent_id

Revision ID: 0004_tag_parent
Revises: 0003_review_state
Create Date: 2026-05-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0004_tag_parent"
down_revision: Union[str, None] = "0003_review_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tags.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_tags_parent_id", "tags", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_tags_parent_id", table_name="tags")
    op.drop_column("tags", "parent_id")
