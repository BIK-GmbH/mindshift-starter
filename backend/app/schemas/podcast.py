from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class PlaylistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    draft_title: str | None = None
    draft_narrative_text: str | None = None
    draft_target_minutes: int | None = None


class PlaylistCardOut(BaseModel):
    card_id: UUID
    position: int
    title: str
    source_type: str
    thumbnail_url: str | None = None


class EpisodeOut(BaseModel):
    id: UUID
    playlist_id: UUID
    title: str
    voice: str
    status: str  # processing | ready | failed
    error_message: str | None = None
    has_audio: bool
    has_cover: bool
    audio_url: str | None
    cover_url: str | None
    created_at: datetime


class PlaylistOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    card_count: int
    has_draft: bool = False


class PlaylistDetail(PlaylistOut):
    cards: list[PlaylistCardOut]
    episodes: list[EpisodeOut]
    draft_title: str | None = None
    draft_narrative_text: str | None = None
    draft_target_minutes: int | None = None


class AddCardRequest(BaseModel):
    card_id: UUID


class AddCardsBulkRequest(BaseModel):
    card_ids: list[UUID]


class ReorderRequest(BaseModel):
    card_ids: list[UUID]


class DraftRequest(BaseModel):
    target_minutes: int = Field(default=5, ge=1, le=20)


class DraftResponse(BaseModel):
    title: str
    narrative_text: str


class ProduceRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    narrative_text: str = Field(min_length=20)
    voice: str | None = None
    generate_cover: bool = True
    cover_prompt: str | None = None
