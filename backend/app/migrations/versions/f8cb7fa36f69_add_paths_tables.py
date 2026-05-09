"""add_paths_tables

Revision ID: f8cb7fa36f69
Revises: 3f0e14b4168f
Create Date: 2026-05-09 16:08:32.324136

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8cb7fa36f69"
down_revision: Union[str, None] = "3f0e14b4168f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "paths",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("description_md", sa.Text(), nullable=True),
        sa.Column("cover_url", sa.String(length=2048), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("completion_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "slug", name="uq_paths_user_slug"),
    )
    op.create_index("ix_paths_user_id", "paths", ["user_id"], unique=False)

    op.create_table(
        "path_cards",
        sa.Column("path_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("lesson_md", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["path_id"], ["paths.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("path_id", "card_id"),
    )
    op.create_index(
        "ix_path_cards_path_position", "path_cards", ["path_id", "position"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_path_cards_path_position", table_name="path_cards")
    op.drop_table("path_cards")
    op.drop_index("ix_paths_user_id", table_name="paths")
    op.drop_table("paths")
