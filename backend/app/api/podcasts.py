"""Podcast playlists + long-form generated episodes.

Workflow:
  1. POST /api/podcasts/playlists → user creates a playlist
  2. POST /api/podcasts/playlists/{id}/cards → adds cards in order
  3. POST /api/podcasts/playlists/{id}/episodes/draft → returns the
     LLM-written script (title + narrative_text). Frontend lets user
     edit it.
  4. POST /api/podcasts/playlists/{id}/episodes → produces audio (Gemini
     TTS) + cover (gpt-image-2) and persists the Episode row
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.file import File
from app.models.podcast import (
    PodcastEpisode,
    PodcastPlaylist,
    PodcastPlaylistCard,
)
from app.models.user import User
from app.schemas.podcast import (
    AddCardRequest,
    DraftRequest,
    DraftResponse,
    EpisodeOut,
    PlaylistCardOut,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistOut,
    PlaylistUpdate,
    ProduceRequest,
    ReorderRequest,
)
from app.services.podcast import (
    generate_cover_image,
    generate_episode_draft,
    synthesize_episode_audio,
)
from app.services.storage import get_storage

router = APIRouter(prefix="/podcasts", tags=["podcasts"])


def _episode_audio_url(eid: UUID) -> str:
    return f"/api/podcasts/episodes/{eid}/audio.wav"


def _episode_cover_url(eid: UUID) -> str:
    return f"/api/podcasts/episodes/{eid}/cover.png"


def _episode_to_out(ep: PodcastEpisode) -> EpisodeOut:
    return EpisodeOut(
        id=ep.id,
        playlist_id=ep.playlist_id,
        title=ep.title,
        voice=ep.voice,
        has_audio=ep.audio_file_id is not None,
        has_cover=ep.cover_file_id is not None,
        audio_url=_episode_audio_url(ep.id) if ep.audio_file_id else None,
        cover_url=_episode_cover_url(ep.id) if ep.cover_file_id else None,
        created_at=ep.created_at,
    )


def _load_playlist(db: Session, pid: UUID, user: User) -> PodcastPlaylist:
    pl = db.get(PodcastPlaylist, pid)
    if pl is None or pl.user_id != user.id:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl


def _load_card_for_user(db: Session, cid: UUID, user: User) -> Card:
    card = db.get(Card, cid)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _load_episode(db: Session, eid: UUID, user: User) -> PodcastEpisode:
    ep = db.get(PodcastEpisode, eid)
    if ep is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    pl = db.get(PodcastPlaylist, ep.playlist_id)
    if pl is None or pl.user_id != user.id:
        raise HTTPException(status_code=404, detail="Episode not found")
    return ep


def _card_count(db: Session, pid: UUID) -> int:
    return (
        db.execute(
            select(PodcastPlaylistCard).where(PodcastPlaylistCard.playlist_id == pid)
        )
        .scalars()
        .all()
        .__len__()
    )


# --- Playlist CRUD ----------------------------------------------------------


@router.get("/playlists", response_model=list[PlaylistOut])
def list_playlists(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlaylistOut]:
    rows = db.execute(
        select(PodcastPlaylist)
        .where(PodcastPlaylist.user_id == current_user.id)
        .order_by(PodcastPlaylist.created_at.desc())
    ).scalars().all()
    return [
        PlaylistOut(
            id=p.id,
            name=p.name,
            description=p.description,
            created_at=p.created_at,
            card_count=_card_count(db, p.id),
        )
        for p in rows
    ]


@router.post("/playlists", response_model=PlaylistOut, status_code=201)
def create_playlist(
    payload: PlaylistCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistOut:
    pl = PodcastPlaylist(
        user_id=current_user.id, name=payload.name.strip(), description=payload.description
    )
    db.add(pl)
    db.commit()
    db.refresh(pl)
    return PlaylistOut(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        created_at=pl.created_at,
        card_count=0,
    )


@router.get("/playlists/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _load_playlist(db, playlist_id, current_user)
    rows = db.execute(
        select(PodcastPlaylistCard, Card)
        .join(Card, Card.id == PodcastPlaylistCard.card_id)
        .where(PodcastPlaylistCard.playlist_id == pl.id)
        .order_by(PodcastPlaylistCard.position.asc())
    ).all()
    cards = [
        PlaylistCardOut(
            card_id=card.id,
            position=link.position,
            title=card.title,
            source_type=card.source_type,
            thumbnail_url=card.thumbnail_url,
        )
        for link, card in rows
    ]
    eps = db.execute(
        select(PodcastEpisode)
        .where(PodcastEpisode.playlist_id == pl.id)
        .order_by(PodcastEpisode.created_at.desc())
    ).scalars().all()
    return PlaylistDetail(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        created_at=pl.created_at,
        card_count=len(cards),
        cards=cards,
        episodes=[_episode_to_out(e) for e in eps],
    )


@router.patch("/playlists/{playlist_id}", response_model=PlaylistOut)
def update_playlist(
    playlist_id: UUID,
    payload: PlaylistUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistOut:
    pl = _load_playlist(db, playlist_id, current_user)
    if payload.name is not None:
        pl.name = payload.name.strip()
    if payload.description is not None:
        pl.description = payload.description
    db.commit()
    db.refresh(pl)
    return PlaylistOut(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        created_at=pl.created_at,
        card_count=_card_count(db, pl.id),
    )


@router.delete("/playlists/{playlist_id}", status_code=204, response_class=Response)
def delete_playlist(
    playlist_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _load_playlist(db, playlist_id, current_user)
    db.delete(pl)
    db.commit()
    return Response(status_code=204)


# --- Card add / remove / reorder --------------------------------------------


@router.post("/playlists/{playlist_id}/cards", response_model=PlaylistDetail)
def add_card_to_playlist(
    playlist_id: UUID,
    payload: AddCardRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _load_playlist(db, playlist_id, current_user)
    _load_card_for_user(db, payload.card_id, current_user)

    existing = db.execute(
        select(PodcastPlaylistCard).where(
            PodcastPlaylistCard.playlist_id == pl.id,
            PodcastPlaylistCard.card_id == payload.card_id,
        )
    ).scalar_one_or_none()
    if existing is None:
        max_pos = db.execute(
            select(PodcastPlaylistCard.position)
            .where(PodcastPlaylistCard.playlist_id == pl.id)
            .order_by(PodcastPlaylistCard.position.desc())
            .limit(1)
        ).scalar_one_or_none()
        next_pos = (max_pos or 0) + 1
        db.add(
            PodcastPlaylistCard(
                playlist_id=pl.id, card_id=payload.card_id, position=next_pos
            )
        )
        db.commit()
    return get_playlist(playlist_id, current_user, db)


@router.delete(
    "/playlists/{playlist_id}/cards/{card_id}",
    response_model=PlaylistDetail,
)
def remove_card_from_playlist(
    playlist_id: UUID,
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _load_playlist(db, playlist_id, current_user)
    db.execute(
        delete(PodcastPlaylistCard).where(
            PodcastPlaylistCard.playlist_id == pl.id,
            PodcastPlaylistCard.card_id == card_id,
        )
    )
    db.commit()
    return get_playlist(playlist_id, current_user, db)


@router.post(
    "/playlists/{playlist_id}/reorder",
    response_model=PlaylistDetail,
)
def reorder_playlist(
    playlist_id: UUID,
    payload: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _load_playlist(db, playlist_id, current_user)
    # Update each card's position to its index in the request.
    for idx, cid in enumerate(payload.card_ids):
        db.execute(
            PodcastPlaylistCard.__table__.update()
            .where(
                PodcastPlaylistCard.playlist_id == pl.id,
                PodcastPlaylistCard.card_id == cid,
            )
            .values(position=idx + 1)
        )
    db.commit()
    return get_playlist(playlist_id, current_user, db)


# --- Episode draft + produce ------------------------------------------------


@router.post(
    "/playlists/{playlist_id}/episodes/draft",
    response_model=DraftResponse,
)
def episode_draft(
    playlist_id: UUID,
    payload: DraftRequest = DraftRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftResponse:
    pl = _load_playlist(db, playlist_id, current_user)
    rows = db.execute(
        select(Card)
        .join(PodcastPlaylistCard, PodcastPlaylistCard.card_id == Card.id)
        .where(PodcastPlaylistCard.playlist_id == pl.id)
        .order_by(PodcastPlaylistCard.position.asc())
    ).scalars().all()
    if not rows:
        raise HTTPException(
            status_code=400, detail="Playlist is empty — add cards first."
        )

    sources = []
    for c in rows:
        summary = (
            c.detailed_summary_md
            or c.concise_summary_md
            or c.notes_md
            or ""
        ).strip()
        sources.append({"title": c.title or "Untitled", "summary": summary})

    try:
        title, narrative = generate_episode_draft(sources, target_minutes=payload.target_minutes)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return DraftResponse(title=title, narrative_text=narrative)


@router.post(
    "/playlists/{playlist_id}/episodes",
    response_model=EpisodeOut,
    status_code=201,
)
def produce_episode(
    playlist_id: UUID,
    payload: ProduceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EpisodeOut:
    pl = _load_playlist(db, playlist_id, current_user)
    storage = get_storage()

    try:
        wav_bytes, voice = synthesize_episode_audio(
            payload.narrative_text, voice=payload.voice
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Audio synthesis failed: {exc}") from exc

    audio_file = storage.save(
        db,
        user_id=current_user.id,
        content=wav_bytes,
        original_filename=f"episode-{pl.id}.wav",
        content_type="audio/wav",
        purpose="podcast_episode_audio",
    )

    cover_file = None
    if payload.generate_cover:
        try:
            png_bytes = generate_cover_image(
                title=payload.title,
                summary_hint=payload.narrative_text[:500],
                custom_prompt=payload.cover_prompt,
            )
            cover_file = storage.save(
                db,
                user_id=current_user.id,
                content=png_bytes,
                original_filename=f"episode-{pl.id}-cover.png",
                content_type="image/png",
                purpose="podcast_episode_cover",
            )
        except Exception as exc:  # noqa: BLE001
            # Non-fatal: keep the audio, skip the cover.
            print(f"Cover generation failed: {exc}")

    ep = PodcastEpisode(
        playlist_id=pl.id,
        title=payload.title.strip(),
        narrative_text=payload.narrative_text,
        voice=voice,
        audio_file_id=audio_file.id,
        cover_file_id=cover_file.id if cover_file else None,
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return _episode_to_out(ep)


@router.delete(
    "/playlists/{playlist_id}/episodes/{episode_id}",
    status_code=204,
    response_class=Response,
)
def delete_episode(
    playlist_id: UUID,
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_episode(db, episode_id, current_user)
    if ep.playlist_id != playlist_id:
        raise HTTPException(status_code=404, detail="Episode not in playlist")
    audio = db.get(File, ep.audio_file_id) if ep.audio_file_id else None
    cover = db.get(File, ep.cover_file_id) if ep.cover_file_id else None
    db.delete(ep)
    storage = get_storage()
    for f in (audio, cover):
        if f is not None:
            try:
                storage.delete(db, f)
            except Exception:  # noqa: BLE001
                pass
    db.commit()
    return Response(status_code=204)


# --- Episode media streams --------------------------------------------------


@router.get("/episodes/{episode_id}/audio.wav")
def stream_episode_audio(
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_episode(db, episode_id, current_user)
    if ep.audio_file_id is None:
        raise HTTPException(status_code=404, detail="No audio")
    f = db.get(File, ep.audio_file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="Audio file missing")
    blob = get_storage().read(f)
    return Response(
        content=blob,
        media_type="audio/wav",
        headers={
            "Content-Disposition": "inline",
            "Content-Length": str(len(blob)),
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/episodes/{episode_id}/cover.png")
def stream_episode_cover(
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_episode(db, episode_id, current_user)
    if ep.cover_file_id is None:
        raise HTTPException(status_code=404, detail="No cover")
    f = db.get(File, ep.cover_file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="Cover file missing")
    blob = get_storage().read(f)
    return Response(
        content=blob,
        media_type="image/png",
        headers={
            "Content-Disposition": "inline",
            "Content-Length": str(len(blob)),
            "Cache-Control": "private, max-age=86400",
        },
    )
