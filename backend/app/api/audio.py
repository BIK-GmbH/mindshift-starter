"""Card audio (podcast) endpoints.

Generation is opt-in (POST). The WAV is persisted via the existing file
storage so it counts toward the user's quota and survives restarts.
The bytes are streamed inline via /api/cards/{id}/audio.wav so HTML5
<audio> can use it as a src.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
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
        narrative_text=audio.narrative_text,
        voice=audio.voice,
        created_at=audio.created_at,
        audio_url=_audio_url(audio.card_id),
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


@router.post("/{card_id}/audio", response_model=CardAudioOut, status_code=201)
def create_card_audio(
    card_id: UUID,
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

    try:
        result = generate_card_podcast(
            title=card.title or "Untitled",
            source_text=source_text,
            voice=payload.voice,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    storage = get_storage()
    new_file = storage.save(
        db,
        user_id=current_user.id,
        content=result.audio_wav_bytes,
        original_filename=f"{card.id}.wav",
        content_type="audio/wav",
        purpose="card_audio",
    )

    # Replace any prior audio row + delete its file (storage dedupes by
    # sha256 so deleting an unrelated row is safe — only the audio bytes
    # for THIS card go away, regenerated text + new sha → new file).
    existing = db.execute(
        select(CardAudio).where(CardAudio.card_id == card_id)
    ).scalar_one_or_none()
    if existing is not None:
        old_file = db.get(File, existing.file_id) if existing.file_id else None
        existing.file_id = new_file.id
        existing.narrative_text = result.narrative_text
        existing.voice = result.voice
        if old_file is not None and old_file.id != new_file.id:
            try:
                storage.delete(db, old_file)
            except Exception:  # noqa: BLE001
                pass
        audio = existing
    else:
        audio = CardAudio(
            card_id=card_id,
            file_id=new_file.id,
            narrative_text=result.narrative_text,
            voice=result.voice,
        )
        db.add(audio)
    db.commit()
    db.refresh(audio)
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
