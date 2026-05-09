"""add_path_progress

Revision ID: 25c2b69fca5c
Revises: f8cb7fa36f69
Create Date: 2026-05-09 16:24:11.062372

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "25c2b69fca5c"
down_revision: Union[str, None] = "f8cb7fa36f69"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "path_progress",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("path_id", sa.UUID(), nullable=False),
        sa.Column("current_position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["path_id"], ["paths.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "path_id", name="uq_path_progress_user_path"),
    )
    op.create_index("ix_path_progress_user_id", "path_progress", ["user_id"], unique=False)
    op.create_index("ix_path_progress_path_id", "path_progress", ["path_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_path_progress_path_id", table_name="path_progress")
    op.drop_index("ix_path_progress_user_id", table_name="path_progress")
    op.drop_table("path_progress")
