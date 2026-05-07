from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid

EMBEDDING_DIMENSIONS = 1536  # text-embedding-3-small


class Embedding(Base, TimestampMixin):
    __tablename__ = "embeddings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    chunk_type: Mapped[str] = mapped_column(String(40), nullable=False, default="transcript")
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
