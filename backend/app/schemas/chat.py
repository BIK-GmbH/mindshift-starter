from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageIn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=40)
    top_k: int = Field(default=5, ge=1, le=20)
    session_id: UUID | None = None  # if set, persist user msg + assistant reply
    # When true, augment the LLM context with Brave web-search snippets
    # of the user's latest message. Falls back to KB-only silently when
    # BRAVE_API_KEY is not configured.
    use_web_search: bool = False


class CitationOut(BaseModel):
    index: int
    card_id: UUID
    title: str
    source_type: str
    chunk_index: int | None = None
    snippet: str


class WebCitationOut(BaseModel):
    index: int
    title: str
    url: str
    description: str
    age: str | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
    web_citations: list[WebCitationOut] = Field(default_factory=list)
    session_id: UUID | None = None  # echo back so frontend can keep using it


# --- Sessions API ----------------------------------------------------------


class ChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    card_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ChatSessionCreate(BaseModel):
    card_id: UUID | None = None
    title: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str | None = None


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: str
    content: str
    citations_json: list | None = None
    web_citations_json: list | None = None
    created_at: datetime


class ChatSessionDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    card_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageOut] = Field(default_factory=list)
