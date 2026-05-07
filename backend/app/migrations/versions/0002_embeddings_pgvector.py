"""embeddings table with pgvector

Revision ID: 0002_embeddings_pgvector
Revises: 0001_initial
Create Date: 2026-05-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSON, UUID

revision: str = "0002_embeddings_pgvector"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EMBEDDING_DIMENSIONS = 1536


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "embeddings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("chunk_type", sa.String(40), nullable=False, server_default="transcript"),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("embedding", Vector(EMBEDDING_DIMENSIONS), nullable=False),
        sa.Column("metadata_json", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # IVFFlat index for cosine distance — needs at least a few hundred rows to outperform
    # the brute-force scan, but adding it now keeps deploys idempotent.
    op.execute(
        "CREATE INDEX IF NOT EXISTS embeddings_embedding_cosine_idx "
        "ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    op.drop_index("embeddings_embedding_cosine_idx", table_name="embeddings")
    op.drop_table("embeddings")
