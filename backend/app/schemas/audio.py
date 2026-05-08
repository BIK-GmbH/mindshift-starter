from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CardAudioOut(BaseModel):
    id: UUID
    card_id: UUID
    narrative_text: str
    voice: str
    status: str  # processing | ready | failed
    error_message: str | None = None
    created_at: datetime
    # Relative URL pointing at the WAV stream endpoint, only when ready.
    audio_url: str | None = None


class GenerateAudioRequest(BaseModel):
    voice: str | None = None
