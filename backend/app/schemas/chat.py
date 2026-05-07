from uuid import UUID

from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=40)
    top_k: int = Field(default=5, ge=1, le=20)


class CitationOut(BaseModel):
    index: int
    card_id: UUID
    title: str
    source_type: str
    chunk_index: int | None = None
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
