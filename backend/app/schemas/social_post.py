from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


Platform = Literal["linkedin", "x", "bluesky"]
Tone = Literal["professional", "casual", "thought_leader", "story", "punchy"]


class SocialPostCreate(BaseModel):
    platform: Platform
    tone: Tone = "professional"
    language: str | None = Field(default=None, max_length=40)
    with_hashtags: bool = True
    with_cta: bool = True
    # Image generation is opt-in because gpt-image-2 takes ~30 s and
    # adds API cost; defaults off so a "Generate" click is fast + cheap.
    with_image: bool = False


class SocialPostOut(BaseModel):
    id: UUID
    card_id: UUID
    platform: str
    text: str
    hashtags: list[str] = []
    character_count: int
    image_url: str | None = None
    tone: str | None = None
    language: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True
