"""Pydantic schemas for the card_highlights table."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class HighlightOut(BaseModel):
    id: UUID
    card_id: UUID
    source_url: str
    anchor_text: str
    prefix: str
    suffix: str
    color: str
    note: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class HighlightCreate(BaseModel):
    """Created from the extension content script. The source URL is
    canonicalised on the server before storage so a later visit with
    a slightly different URL still resolves."""

    anchor_text: str = Field(min_length=1, max_length=4000)
    prefix: str = Field(default="", max_length=128)
    suffix: str = Field(default="", max_length=128)
    color: str = Field(default="yellow", max_length=16)
    note: str = Field(default="", max_length=4000)


class HighlightUpdate(BaseModel):
    """Note + color edit. The anchor itself stays immutable; if the
    user wants to re-position, they delete and re-create."""

    color: str | None = Field(default=None, max_length=16)
    note: str | None = Field(default=None, max_length=4000)
