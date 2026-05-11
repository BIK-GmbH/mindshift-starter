from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class FeedCreate(BaseModel):
    feed_url: HttpUrl
    # Optional override; if empty, the feed's own <title> is used after
    # the first successful poll.
    title: str | None = Field(default=None, max_length=300)


class FeedUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None


class FeedOut(BaseModel):
    id: UUID
    feed_url: str
    title: str
    site_url: str | None = None
    is_active: bool
    last_polled_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    items_ingested: int
    created_at: datetime

    class Config:
        from_attributes = True


class FeedRefreshResult(BaseModel):
    queued: int
    skipped_seen: int
    error: str | None = None


class FeedRefreshAllResult(BaseModel):
    """Aggregate summary across every active feed the user owns.

    `per_feed_errors` collects feed_id → error string for any
    individual poll that failed, so the UI can flag them inline.
    """

    feeds_polled: int
    queued: int
    skipped_seen: int
    per_feed_errors: dict[str, str] = {}
