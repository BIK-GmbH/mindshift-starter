"""Voice-to-text transcription via OpenAI.

Auth-gated, 25 MB cap, no rate limit yet. The audio blob is uploaded
chunk-by-chunk to avoid loading huge payloads into memory; if the body
exceeds MAX_BYTES we 413 mid-stream.
"""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

MAX_BYTES = 25 * 1024 * 1024  # OpenAI hard limit
READ_CHUNK = 64 * 1024


@router.post("")
async def transcribe(
    audio: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Stream upload, cap at 25 MB, call OpenAI, return the transcript."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await audio.read(READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Audio too large: max {MAX_BYTES // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="Transcription unavailable: OPENAI_API_KEY not configured.",
        )

    from openai import OpenAI  # local import keeps cold-start light

    client = OpenAI(api_key=settings.openai_api_key)
    fname = audio.filename or "recording.webm"
    file_obj = io.BytesIO(audio_bytes)
    file_obj.name = fname  # OpenAI infers format from filename
    try:
        result = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=(fname, file_obj, audio.content_type or "audio/webm"),
            response_format="json",
        )
        text = (result.text or "").strip()
    except Exception as exc:  # OpenAI SDK raises various subtypes; collapse to 502
        raise HTTPException(
            status_code=502,
            detail=f"Transcription failed: {type(exc).__name__}",
        ) from exc
    return {"text": text, "audio_bytes": total}
