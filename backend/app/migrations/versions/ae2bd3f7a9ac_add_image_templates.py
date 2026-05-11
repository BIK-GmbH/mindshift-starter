"""add image_templates

Revision ID: ae2bd3f7a9ac
Revises: 3a65c6eb0cf0
Create Date: 2026-05-11 12:30:19.538525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'ae2bd3f7a9ac'
down_revision: Union[str, None] = '3a65c6eb0cf0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "image_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
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
        sa.UniqueConstraint("user_id", "name", name="uq_image_templates_user_name"),
    )
    op.create_index("ix_image_templates_user_id", "image_templates", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_image_templates_user_id", table_name="image_templates")
    op.drop_table("image_templates")
