from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CardAudioOut(BaseModel):
    id: UUID
    card_id: UUID
    narrative_text: str
    voice: str
    created_at: datetime
    # Relative URL pointing at the WAV stream endpoint. The frontend
    # prepends API_BASE if needed.
    audio_url: str


class GenerateAudioRequest(BaseModel):
    voice: str | None = None
