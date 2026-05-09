"""add_path_quiz_attempts

Revision ID: 61e67a85908c
Revises: 25c2b69fca5c
Create Date: 2026-05-09 16:43:29.860821

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "61e67a85908c"
down_revision: Union[str, None] = "25c2b69fca5c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "path_quiz_attempts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("path_id", sa.UUID(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
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
    )
    op.create_index("ix_path_quiz_attempts_user_id", "path_quiz_attempts", ["user_id"])
    op.create_index("ix_path_quiz_attempts_path_id", "path_quiz_attempts", ["path_id"])


def downgrade() -> None:
    op.drop_index("ix_path_quiz_attempts_path_id", table_name="path_quiz_attempts")
    op.drop_index("ix_path_quiz_attempts_user_id", table_name="path_quiz_attempts")
    op.drop_table("path_quiz_attempts")
