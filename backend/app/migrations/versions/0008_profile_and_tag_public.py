"""user profile fields + tag is_public

Revision ID: 0008_profile_and_tag_public
Revises: 0007_files
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0008_profile_and_tag_public"
down_revision: Union[str, None] = "0007_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users gain a public-profile shape: username (slug, unique), bio,
    # avatar (FK into files), and an explicit public-profile toggle.
    op.add_column("users", sa.Column("username", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text, nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "avatar_file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column("public_profile", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    op.create_index("ix_users_username", "users", ["username"])

    # Tags gain a `is_public` flag. When true, the tag (and its sub-tags)
    # become readable on the user's public profile page.
    op.add_column(
        "tags",
        sa.Column("is_public", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_tags_is_public", "tags", ["is_public"])


def downgrade() -> None:
    op.drop_index("ix_tags_is_public", table_name="tags")
    op.drop_column("tags", "is_public")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "public_profile")
    op.drop_column("users", "avatar_file_id")
    op.drop_column("users", "bio")
    op.drop_column("users", "username")
