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
    is_public: bool | None = None


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
    is_public: bool = False


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
    # Natural-language hint or ISO code; None = let the model auto-detect
    # from the source cards.
    language: str | None = None


class DraftResponse(BaseModel):
    title: str
    narrative_text: str


class ProduceRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    narrative_text: str = Field(min_length=20)
    voice: str | None = None
    generate_cover: bool = True
    # Free-form description of what the cover should show / mood / style.
    # Appended to the base template (not a replacement).
    cover_style: str | None = None
    # Optional text to render onto the cover. gpt-image-2 handles
    # in-image text well. None / empty → no text overlay.
    cover_text: str | None = None
    # Power-user complete override of the prompt (skips template + hints).
    cover_prompt: str | None = None


class EpisodeShareOut(BaseModel):
    token: str
    public_url: str
    embed_url: str
    audio_url: str
    cover_url: str | None
    created_at: datetime


class PublicEpisodeOut(BaseModel):
    title: str
    voice: str
    narrative_text: str
    audio_url: str
    cover_url: str | None
    created_at: datetime


class FromTagRequest(BaseModel):
    tag_name: str = Field(min_length=1)
    include_subtags: bool = True
    name: str | None = None


class CoverSuggestRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    narrative_text: str = Field(min_length=20)


class CoverSuggestResponse(BaseModel):
    cover_style: str
    cover_text: str
