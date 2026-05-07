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
