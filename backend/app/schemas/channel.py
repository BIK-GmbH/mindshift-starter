"""Pydantic schemas for YouTube channel subscriptions."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

IngestMode = Literal["manual", "auto"]
VideoTab = Literal["latest", "popular", "saved"]


class ChannelSearchResultOut(BaseModel):
    """One result of `GET /channels/search` or `POST /channels/resolve`.

    No DB id — these are unsubscribed candidates from the YouTube Data
    API. The user calls `POST /channels` with `channel_id` to commit.
    """

    channel_id: str
    title: str
    handle: str | None = None
    thumbnail_url: str | None = None
    subscriber_count: int | None = None
    description: str | None = None


class ChannelSuggestionOut(ChannelSearchResultOut):
    """Library-derived suggestion: same shape + how many of the user's
    existing YouTube cards are from this channel."""

    card_count_in_library: int


class ChannelResolveIn(BaseModel):
    url_or_handle: str = Field(min_length=1, max_length=512)


class ChannelSubscribeIn(BaseModel):
    channel_id: str = Field(min_length=10, max_length=40)


class ChannelPatchIn(BaseModel):
    ingest_mode: IngestMode | None = None
    exclude_shorts: bool | None = None


class ChannelSubscriptionOut(BaseModel):
    id: UUID
    channel_id: str
    handle: str | None = None
    title: str
    thumbnail_url: str | None = None
    description: str | None = None
    subscriber_count: int | None = None
    ingest_mode: IngestMode
    exclude_shorts: bool
    unread_count: int
    items_ingested: int
    last_polled_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChannelVideoOut(BaseModel):
    video_id: str
    title: str
    thumbnail_url: str | None = None
    duration_seconds: int | None = None
    published_at: datetime | None = None
    is_short: bool
    read_at: datetime | None = None
    saved_card_id: UUID | None = None
    # `popular` tab returns view_count too.
    view_count: int | None = None

    class Config:
        from_attributes = True


class ChannelVideoListOut(BaseModel):
    tab: VideoTab
    items: list[ChannelVideoOut]
    total: int


class ChannelSaveResult(BaseModel):
    card_id: UUID


class ChannelBulkSaveResult(BaseModel):
    queued: int


class ChannelRefreshResult(BaseModel):
    new_videos: int
    queued_ingestion: int
    error: str | None = None
