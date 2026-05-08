from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class GraphPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    settings: dict[str, Any]


class GraphPresetOut(BaseModel):
    id: UUID
    name: str
    settings: dict[str, Any]
    created_at: datetime
