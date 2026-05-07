from uuid import UUID

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Transcript(Base, TimestampMixin):
    __tablename__ = "transcripts"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    segments_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
