from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=50)


class SearchHit(BaseModel):
    card_id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    snippet: str
    chunk_type: str | None = None
    chunk_index: int | None = None
    score: float
    created_at: datetime
    # Set when the hit comes from a transcript segment with a known
    # offset (YouTube). Lets the UI render the result with a clickable
    # "▶ 02:34" pill that opens the source at the exact second.
    timestamp_seconds: int | None = None
    # YouTube video id, when known and the hit is segmented. Lets the
    # frontend build the full deep-link without an extra round-trip.
    youtube_video_id: str | None = None
