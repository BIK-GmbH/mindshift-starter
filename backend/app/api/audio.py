"""Card audio (podcast) endpoints.

Generation is opt-in (POST). The WAV is persisted via the existing file
storage so it counts toward the user's quota and survives restarts.
The bytes are streamed inline via /api/cards/{id}/audio.wav so HTML5
<audio> can use it as a src.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.card import Card
from app.models.card_audio import CardAudio
from app.models.file import File
from app.models.user import User
from app.schemas.audio import CardAudioOut, GenerateAudioRequest
from app.services.podcast import generate_card_podcast
from app.services.storage import get_storage

router = APIRouter(prefix="/cards", tags=["audio"])


def _audio_url(card_id: UUID) -> str:
    return f"/api/cards/{card_id}/audio.wav"


def _to_out(audio: CardAudio) -> CardAudioOut:
    return CardAudioOut(
        id=audio.id,
        card_id=audio.card_id,
        narrative_text=audio.narrative_text or "",
        voice=audio.voice,
        status=audio.status,
        error_message=audio.error_message,
        created_at=audio.created_at,
        audio_url=_audio_url(audio.card_id) if audio.status == "ready" else None,
    )


def _load_owned_card(db: Session, card_id: UUID, user: User) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _source_text_for(card: Card) -> str:
    """Pick the best text to feed the narrative rewriter."""
    parts: list[str] = []
    if card.title:
        parts.append(card.title)
    if card.concise_summary_md:
        parts.append(card.concise_summary_md)
    elif card.detailed_summary_md:
        parts.append(card.detailed_summary_md)
    if card.notes_md:
        parts.append(card.notes_md)
    text = "\n\n".join(p.strip() for p in parts if p and p.strip())
    return text


@router.get("/{card_id}/audio", response_model=CardAudioOut)
def get_card_audio(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardAudioOut:
    _load_owned_card(db, card_id, current_user)
    audio = db.execute(
        select(CardAudio).where(CardAudio.card_id == card_id)
    ).scalar_one_or_none()
    if audio is None:
        raise HTTPException(status_code=404, detail="No audio generated yet")
    return _to_out(audio)


def _run_card_audio_job(
    *,
    card_audio_id: UUID,
    user_id: UUID,
    card_title: str,
    source_text: str,
    voice: str | None,
) -> None:
    """Background worker. Owns its own DB session. Updates status on
    the CardAudio row when finished/failed."""
    db = SessionLocal()
    try:
        audio = db.get(CardAudio, card_audio_id)
        if audio is None:
            return
        try:
            result = generate_card_podcast(
                title=card_title or "Untitled",
                source_text=source_text,
                voice=voice,
            )
            storage = get_storage()
            new_file = storage.save(
                db,
                user_id=user_id,
                content=result.audio_wav_bytes,
                original_filename=f"{audio.card_id}.wav",
                content_type="audio/wav",
                purpose="card_audio",
            )
            old_file = db.get(File, audio.file_id) if audio.file_id else None
            audio.file_id = new_file.id
            audio.narrative_text = result.narrative_text
            audio.voice = result.voice
            audio.status = "ready"
            audio.error_message = None
            if old_file is not None and old_file.id != new_file.id:
                try:
                    storage.delete(db, old_file)
                except Exception:  # noqa: BLE001
                    pass
            db.commit()
        except Exception as exc:  # noqa: BLE001
            audio.status = "failed"
            audio.error_message = str(exc)[:500]
            db.commit()
    finally:
        db.close()


@router.post("/{card_id}/audio", response_model=CardAudioOut, status_code=202)
def create_card_audio(
    card_id: UUID,
    background_tasks: BackgroundTasks,
    payload: GenerateAudioRequest = GenerateAudioRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardAudioOut:
    card = _load_owned_card(db, card_id, current_user)
    source_text = _source_text_for(card)
    if len(source_text.strip()) < 40:
        raise HTTPException(
            status_code=400,
            detail="Card has too little text to narrate. Add a summary or notes first.",
        )

    # Upsert a row in "processing" state, returning immediately.
    existing = db.execute(
        select(CardAudio).where(CardAudio.card_id == card_id)
    ).scalar_one_or_none()
    if existing is not None:
        existing.status = "processing"
        existing.error_message = None
        # Keep the previous file_id around so the old audio stays playable
        # while the new one renders; the worker swaps it on success.
        audio = existing
    else:
        audio = CardAudio(
            card_id=card_id,
            file_id=None,
            narrative_text="",
            voice=payload.voice or "Kore",
            status="processing",
        )
        db.add(audio)
    db.commit()
    db.refresh(audio)

    background_tasks.add_task(
        _run_card_audio_job,
        card_audio_id=audio.id,
        user_id=current_user.id,
        card_title=card.title or "",
        source_text=source_text,
        voice=payload.voice,
    )
    return _to_out(audio)


@router.delete("/{card_id}/audio", status_code=204, response_class=Response)
def delete_card_audio(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    _load_owned_card(db, card_id, current_user)
    audio = db.execute(
        select(CardAudio).where(CardAudio.card_id == card_id)
    ).scalar_one_or_none()
    if audio is None:
        return Response(status_code=204)
    file = db.get(File, audio.file_id) if audio.file_id else None
    db.delete(audio)
    if file is not None:
        try:
            get_storage().delete(db, file)
        except Exception:  # noqa: BLE001
            pass
    db.commit()
    return Response(status_code=204)


@router.get("/{card_id}/audio.wav")
def stream_card_audio(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    _load_owned_card(db, card_id, current_user)
    audio = db.execute(
        select(CardAudio).where(CardAudio.card_id == card_id)
    ).scalar_one_or_none()
    if audio is None or audio.file_id is None:
        raise HTTPException(status_code=404, detail="No audio generated yet")
    file = db.get(File, audio.file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="Audio file missing")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type="audio/wav",
        headers={
            "Content-Disposition": "inline",
            "Content-Length": str(len(blob)),
            "Cache-Control": "private, max-age=3600",
        },
    )
