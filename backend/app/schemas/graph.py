from uuid import UUID

from pydantic import BaseModel


class ReasonOut(BaseModel):
    kind: str
    label: str
    weight: float


class ConnectionOut(BaseModel):
    card_id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    score: float
    reasons: list[ReasonOut]
