from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ReviewQueueItem(BaseModel):
    id: UUID
    card_id: UUID
    card_title: str
    question: str
    answer: str
    question_type: str
    difficulty: str | None = None
    stage: str
    interval_days: float
    lapses: int
    last_reviewed_at: datetime | None = None
    next_due_at: datetime | None = None
    created_at: datetime


class AnswerRequest(BaseModel):
    rating: str = Field(pattern="^(again|hard|good|easy)$")


class AnswerResponse(BaseModel):
    question_id: UUID
    rating: str
    stage: str
    interval_days: float
    next_due_at: datetime
    lapses: int


class ReviewStats(BaseModel):
    total: int
    due_now: int
    new: int
    learning: int
    practiced: int
    confident: int
    mastered: int
