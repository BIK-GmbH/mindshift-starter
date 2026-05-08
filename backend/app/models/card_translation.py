"""Per-language translations of card title + summary fields.

The original card content stays untouched; translations live in this
side table, one row per (card, language). Generated async via gpt-5.4-mini
in a BackgroundTask.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid


class CardTranslation(Base):
    __tablename__ = "card_translations"
    __table_args__ = (
        UniqueConstraint("card_id", "language", name="uq_card_translations_card_lang"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    language: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    concise_summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    detailed_summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # processing | ready | failed
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ready", server_default="ready"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
