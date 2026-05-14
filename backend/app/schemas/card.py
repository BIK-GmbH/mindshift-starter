from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class CardBase(BaseModel):
    title: str
    source_type: str
    status: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None
    detailed_summary_md: str | None = None
    key_takeaways_json: list | None = None
    notes_md: str | None = None
    error_message: str | None = None


class CardOut(CardBase):
    id: UUID
    user_id: UUID
    source_id: UUID | None = None
    original_file_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    # Tag names attached to this card.
    tags: list[str] = Field(default_factory=list)
    # Original source URL (YouTube watch link, article URL, …) — used by
    # the card detail to embed playback / link out.
    source_url: str | None = None
    # YouTube video id when source_type == "youtube" (kept generic so
    # other source types can use it later).
    external_id: str | None = None
    # Free-form metadata captured during ingestion. Shape depends on
    # source_type — e.g. github carries stars/forks/topics/license. The
    # frontend type-narrows on source_type before reading.
    source_metadata: dict | None = None
    # Reachable via at least one public tag — surfaces a "this is public"
    # warning in the notes editor so accidental edits don't leak.
    is_public: bool = False
    public_via_tags: list[str] = Field(default_factory=list)
    # YouTube channel subscribe-context — only populated for YouTube
    # cards. Either `channel_subscription_id` (user already subscribed)
    # or `channel_resolvable` (channel_id + title we can subscribe to)
    # is set, never both. Both null means we couldn't recover a channel
    # id (older cards ingested before channel_id capture landed).
    channel_subscription_id: UUID | None = None
    channel_resolvable: dict | None = None

    class Config:
        from_attributes = True


class CardListItem(BaseModel):
    id: UUID
    title: str
    source_type: str
    status: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CardUpdate(BaseModel):
    title: str | None = None
    notes_md: str | None = None


class FromYouTubeRequest(BaseModel):
    url: HttpUrl
    paused: bool = Field(
        default=False,
        description=(
            "If true, create the card in 'paused' status without "
            "scheduling any background ingestion. The user can later "
            "trigger /cards/{id}/process to spend AI tokens. Used by "
            "the read-later flow."
        ),
    )


class FromUrlRequest(BaseModel):
    url: HttpUrl
    paused: bool = Field(default=False)
    page_html: str | None = Field(
        default=None,
        max_length=5_000_000,
        description=(
            "Optional pre-rendered HTML from the user's authenticated browser "
            "(set by the extension). When present, the backend uses this instead "
            "of fetching the URL itself — bypasses login walls."
        ),
    )


class BySourceUrlsRequest(BaseModel):
    """Bulk variant of /by-source-url. Used by the SERP-overlay content
    script to check ten search results in a single round-trip instead
    of hammering the per-URL endpoint."""

    urls: list[str] = Field(min_length=1, max_length=50)


class FromNoteRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(default="", max_length=200_000)
    summarize: bool = Field(default=False, description="Run AI summary on the note body")


class JobOut(BaseModel):
    id: UUID
    card_id: UUID | None
    job_type: str
    status: str
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IngestionResponse(BaseModel):
    card: CardOut
    job: JobOut


class QuizQuestionOut(BaseModel):
    id: UUID
    card_id: UUID
    question: str
    answer: str
    question_type: str
    difficulty: str | None = None
    choices_json: list[str] | None = None

    class Config:
        from_attributes = True


class NotesUpdate(BaseModel):
    notes_md: str = Field(default="")
