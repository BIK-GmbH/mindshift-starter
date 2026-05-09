"""Learning path models.

A *path* is an ordered, user-curated sequence of cards on a topic.
Owners assemble paths in the editor; consumers walk through them card
by card. Paths can be made public the same way tags are — the slug +
username pair gives a stable shareable URL.

The MVP intentionally leaves a few hooks unimplemented (per-step
lessons, completion tracking, embedded quiz mode) — they live on this
schema as nullable fields so they can be filled in later without a
migration.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid


class Path(Base, TimestampMixin):
    __tablename__ = "paths"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # URL-safe identifier for public sharing (`/u/<user>/path/<slug>`).
    # Unique per user. Generated from title on create, editable later.
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    description_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional cover image. The MVP doesn't auto-generate it — the editor
    # accepts a URL — but a future job could fire gpt-image-2 against the
    # title + first card titles.
    cover_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Reserved for phase 4.5: keep the hook so we don't migrate later.
    # Counts how many users finished the path (own progress is tracked
    # in `path_progress` once that's added).
    completion_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    cards: Mapped[list["PathCard"]] = relationship(
        back_populates="path",
        cascade="all, delete-orphan",
        order_by="PathCard.position",
    )

    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_paths_user_slug"),
    )


class PathCard(Base):
    """Junction with explicit ordering. Position is an integer, dense:
    we re-number on reorder so the UI never has to deal with float gaps."""

    __tablename__ = "path_cards"

    path_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("paths.id", ondelete="CASCADE"), primary_key=True
    )
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    # Per-step note from the path author — shown above the card content
    # in player mode. Optional; renders as markdown.
    lesson_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )

    path: Mapped[Path] = relationship(back_populates="cards")
