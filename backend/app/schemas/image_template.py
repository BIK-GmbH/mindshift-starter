from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ImageTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)
    is_default: bool = False


class ImageTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    content: str | None = Field(default=None, min_length=1)
    is_default: bool | None = None


class ImageTemplateOut(BaseModel):
    id: UUID
    name: str
    content: str
    is_default: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
