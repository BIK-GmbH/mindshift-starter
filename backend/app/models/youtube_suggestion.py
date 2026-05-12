from uuid import UUID

from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class YouTubeSuggestionCache(Base, TimestampMixin):
    """Per-user cache of YouTube Data API search results.

    `scope`:
      - 'card'           — scope_key = card_id, query derived from card tags/entities
      - 'discover_theme' — scope_key = theme slug, query derived from the cluster

    A row is considered fresh for 24 h since `created_at`; older rows are
    ignored at read time and overwritten on the next miss. Keeps the
    YouTube Data API quota tractable — 1 search.list = 100 units, free
    pool is 10 000 / day.
    """

    __tablename__ = "youtube_suggestion_cache"
    __table_args__ = (
        UniqueConstraint("user_id", "scope", "scope_key", name="uq_yt_cache_user_scope"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    scope_key: Mapped[str] = mapped_column(String(255), nullable=False)
    query: Mapped[str] = mapped_column(String(500), nullable=False)
    results_json: Mapped[list] = mapped_column(JSON, nullable=False)
