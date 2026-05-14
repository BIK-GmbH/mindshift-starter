from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ChannelVideoPopCache(Base):
    """24h-TTL cache for a subscription's 'Popular' tab.

    YouTube Data API `search.list?order=viewCount` costs 100 units per
    call. Channels rarely change their top videos within a day; caching
    the top-N response keeps the Popular tab free for repeat views.
    """

    __tablename__ = "channel_video_pop_cache"

    subscription_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("channel_subscriptions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    payload: Mapped[list] = mapped_column(JSON, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
