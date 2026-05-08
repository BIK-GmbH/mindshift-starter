from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TranslationCreate(BaseModel):
    language: str = Field(min_length=1, max_length=40)


class CardTranslationOut(BaseModel):
    id: UUID
    card_id: UUID
    language: str
    title: str | None
    concise_summary_md: str | None
    detailed_summary_md: str | None
    status: str  # processing | ready | failed
    error_message: str | None = None
    created_at: datetime
