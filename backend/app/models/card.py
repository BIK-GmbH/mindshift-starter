from uuid import UUID

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid


class Card(Base, TimestampMixin):
    __tablename__ = "cards"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sources.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    concise_summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    detailed_summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_takeaways_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    notes_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    source = relationship("Source", lazy="joined")
