from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class ChannelSubscription(Base, TimestampMixin):
    """A user's subscription to a YouTube channel.

    Polled periodically by `services.channel_scheduler` via the free
    Atom feed at `youtube.com/feeds/videos.xml?channel_id=<UC...>`. New
    uploads land in `channel_videos` with `read_at=NULL` (an unread
    inbox); when `ingest_mode='auto'` the scheduler also triggers the
    existing `from-youtube` ingestion pipeline for each new entry.
    """

    __tablename__ = "channel_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "channel_id", name="uq_channel_subs_user_channel"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # YouTube canonical channel id (always starts with "UC", 24 chars).
    channel_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    handle: Mapped[str | None] = mapped_column(String(120), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    subscriber_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 'manual' | 'auto'. Default manual — new videos appear as unread,
    # the user decides what to ingest.
    ingest_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    exclude_shorts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    last_etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    items_ingested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
