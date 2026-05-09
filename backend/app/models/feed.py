from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Feed(Base, TimestampMixin):
    """RSS / Atom subscription owned by a single user.

    Polled periodically by the in-process scheduler in `services.feed_scheduler`.
    Each new item that hasn't been seen before is queued through the existing
    article ingestion pipeline (so summaries, embeddings, tags etc. all happen
    automatically).

    Dedup primarily on `Source.url` — if a card with the same canonical URL
    already exists for this user, we skip the item.
    """

    __tablename__ = "feeds"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The feed XML URL the user subscribed to (e.g. /feed.xml, /rss).
    feed_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    # User-editable title — defaults to the feed's <title> on first poll.
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    # Site root from the feed's <link> — used for the favicon and the
    # link-out icon in the feed list.
    site_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # When false, the scheduler skips this row entirely.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Conditional-GET state so we don't re-download unchanged feeds.
    last_etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(255), nullable=True)

    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Running count of cards this feed has produced. Useful for the UI list
    # without an extra join + count.
    items_ingested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
