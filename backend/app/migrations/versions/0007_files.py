"""files table

Revision ID: 0007_files
Revises: 0006_card_shares
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0007_files"
down_revision: Union[str, None] = "0006_card_shares"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column(
            "content_type",
            sa.String(120),
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("storage_path", sa.String(800), nullable=False, unique=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("purpose", sa.String(40), nullable=False, server_default="generic"),
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
    )
    op.create_index("ix_files_user_id", "files", ["user_id"])
    op.create_index("ix_files_sha256", "files", ["sha256"])
    op.create_index("ix_files_purpose", "files", ["purpose"])

    # Cards optionally link to the original file they were ingested from.
    op.add_column(
        "cards",
        sa.Column(
            "original_file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_cards_original_file_id", "cards", ["original_file_id"])


def downgrade() -> None:
    op.drop_index("ix_cards_original_file_id", table_name="cards")
    op.drop_column("cards", "original_file_id")
    op.drop_index("ix_files_purpose", table_name="files")
    op.drop_index("ix_files_sha256", table_name="files")
    op.drop_index("ix_files_user_id", table_name="files")
    op.drop_table("files")
