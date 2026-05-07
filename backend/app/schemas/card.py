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
    created_at: datetime
    updated_at: datetime

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


class FromUrlRequest(BaseModel):
    url: HttpUrl


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

    class Config:
        from_attributes = True


class NotesUpdate(BaseModel):
    notes_md: str = Field(default="")
