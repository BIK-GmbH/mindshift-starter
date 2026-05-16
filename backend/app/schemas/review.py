from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ReviewQueueItem(BaseModel):
    id: UUID
    card_id: UUID
    card_title: str
    # Optional cover image + source type so the review UI can show a
    # small thumbnail next to the title — visual anchor for which card
    # the question is about. Recall-style.
    card_thumbnail_url: str | None = None
    card_source_type: str
    question: str
    answer: str
    question_type: str
    difficulty: str | None = None
    choices_json: list[str] | None = None
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


class LearningSessionItem(BaseModel):
    id: UUID
    started_at: datetime
    ended_at: datetime
    event_count: int
    correct_count: int


class SessionEventOut(BaseModel):
    id: UUID
    reviewed_at: datetime
    rating: str
    stage: str | None
    interval_days: int | None
    question_id: UUID
    question: str
    answer: str
    card_id: UUID
    card_title: str


class SessionDetail(BaseModel):
    id: UUID
    started_at: datetime
    ended_at: datetime
    event_count: int
    correct_count: int
    events: list[SessionEventOut]


class ActivityDay(BaseModel):
    date: str  # YYYY-MM-DD (UTC)
    count: int
    correct: int
