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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.card import Card
from app.models.file import File
from app.models.podcast import (
    EpisodeShare,
    PodcastEpisode,
    PodcastPlaylist,
    PodcastPlaylistCard,
)
from app.models.user import User
from app.schemas.podcast import (
    AddCardRequest,
    AddCardsBulkRequest,
    CoverSuggestRequest,
    CoverSuggestResponse,
    DraftRequest,
    DraftResponse,
    EpisodeOut,
    EpisodeShareOut,
    FromTagRequest,
    PlaylistCardOut,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistOut,
    PlaylistUpdate,
    ProduceRequest,
    PublicEpisodeOut,
    ReorderRequest,
)
from app.services.podcast import (
    generate_cover_image,
    generate_episode_draft,
    suggest_cover_meta,
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
        status=ep.status,
        error_message=ep.error_message,
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
            has_draft=bool(p.draft_narrative_text),
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
        has_draft=False,
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
        has_draft=bool(pl.draft_narrative_text),
        cards=cards,
        episodes=[_episode_to_out(e) for e in eps],
        draft_title=pl.draft_title,
        draft_narrative_text=pl.draft_narrative_text,
        draft_target_minutes=pl.draft_target_minutes,
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
    if payload.draft_title is not None:
        pl.draft_title = payload.draft_title or None
    if payload.draft_narrative_text is not None:
        pl.draft_narrative_text = payload.draft_narrative_text or None
    if payload.draft_target_minutes is not None:
        pl.draft_target_minutes = payload.draft_target_minutes
    db.commit()
    db.refresh(pl)
    return PlaylistOut(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        created_at=pl.created_at,
        card_count=_card_count(db, pl.id),
        has_draft=bool(pl.draft_narrative_text),
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


@router.post(
    "/playlists/{playlist_id}/cards/bulk",
    response_model=PlaylistDetail,
)
def add_cards_bulk(
    playlist_id: UUID,
    payload: AddCardsBulkRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _load_playlist(db, playlist_id, current_user)
    if not payload.card_ids:
        return get_playlist(playlist_id, current_user, db)

    # Validate every card belongs to this user.
    owned_ids = set(
        db.execute(
            select(Card.id).where(
                Card.id.in_(payload.card_ids), Card.user_id == current_user.id
            )
        ).scalars().all()
    )

    existing_ids = set(
        db.execute(
            select(PodcastPlaylistCard.card_id).where(
                PodcastPlaylistCard.playlist_id == pl.id
            )
        ).scalars().all()
    )

    max_pos = db.execute(
        select(PodcastPlaylistCard.position)
        .where(PodcastPlaylistCard.playlist_id == pl.id)
        .order_by(PodcastPlaylistCard.position.desc())
        .limit(1)
    ).scalar_one_or_none() or 0

    next_pos = max_pos
    for cid in payload.card_ids:
        if cid not in owned_ids or cid in existing_ids:
            continue
        next_pos += 1
        db.add(
            PodcastPlaylistCard(playlist_id=pl.id, card_id=cid, position=next_pos)
        )
        existing_ids.add(cid)
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
    "/episodes/cover-suggest",
    response_model=CoverSuggestResponse,
)
def episode_cover_suggest(
    payload: CoverSuggestRequest,
    _user: User = Depends(get_current_user),
) -> CoverSuggestResponse:
    """Propose cover_style + cover_text from the episode title + script."""
    try:
        result = suggest_cover_meta(payload.title, payload.narrative_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CoverSuggestResponse(
        cover_style=result.get("cover_style", ""),
        cover_text=result.get("cover_text", ""),
    )


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

    # Persist the draft on the playlist so the user doesn't lose work
    # if they navigate away before producing the episode.
    pl.draft_title = title
    pl.draft_narrative_text = narrative
    pl.draft_target_minutes = payload.target_minutes
    db.commit()

    return DraftResponse(title=title, narrative_text=narrative)


def _run_episode_job(
    *,
    episode_id: UUID,
    user_id: UUID,
    voice: str | None,
    generate_cover: bool,
    cover_prompt: str | None,
    cover_style: str | None,
    cover_text: str | None,
) -> None:
    """Background worker for episode synthesis. Owns its own DB session."""
    db = SessionLocal()
    try:
        ep = db.get(PodcastEpisode, episode_id)
        if ep is None:
            return
        try:
            wav_bytes, used_voice = synthesize_episode_audio(
                ep.narrative_text, voice=voice
            )
            storage = get_storage()
            audio_file = storage.save(
                db,
                user_id=user_id,
                content=wav_bytes,
                original_filename=f"episode-{ep.playlist_id}.wav",
                content_type="audio/wav",
                purpose="podcast_episode_audio",
            )
            ep.audio_file_id = audio_file.id
            ep.voice = used_voice

            if generate_cover:
                try:
                    png_bytes = generate_cover_image(
                        title=ep.title,
                        summary_hint=ep.narrative_text[:500],
                        custom_prompt=cover_prompt,
                        style_hint=cover_style,
                        cover_text=cover_text,
                    )
                    cover_file = storage.save(
                        db,
                        user_id=user_id,
                        content=png_bytes,
                        original_filename=f"episode-{ep.playlist_id}-cover.png",
                        content_type="image/png",
                        purpose="podcast_episode_cover",
                    )
                    ep.cover_file_id = cover_file.id
                except Exception as exc:  # noqa: BLE001
                    # Cover is best-effort. Audio still ships.
                    print(f"Cover generation failed: {exc}")

            ep.status = "ready"
            ep.error_message = None
            db.commit()
        except Exception as exc:  # noqa: BLE001
            ep.status = "failed"
            ep.error_message = str(exc)[:500]
            db.commit()
    finally:
        db.close()


@router.post(
    "/playlists/{playlist_id}/episodes",
    response_model=EpisodeOut,
    status_code=202,
)
def produce_episode(
    playlist_id: UUID,
    payload: ProduceRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EpisodeOut:
    pl = _load_playlist(db, playlist_id, current_user)

    # Insert the episode in "processing" state and return immediately.
    # Audio + cover get filled in by the background worker.
    ep = PodcastEpisode(
        playlist_id=pl.id,
        title=payload.title.strip(),
        narrative_text=payload.narrative_text,
        voice=payload.voice or "Kore",
        status="processing",
    )
    db.add(ep)
    # Producing locks the script in — clear the editable draft.
    pl.draft_title = None
    pl.draft_narrative_text = None
    pl.draft_target_minutes = None
    db.commit()
    db.refresh(ep)

    background_tasks.add_task(
        _run_episode_job,
        episode_id=ep.id,
        user_id=current_user.id,
        voice=payload.voice,
        generate_cover=payload.generate_cover,
        cover_prompt=payload.cover_prompt,
        cover_style=payload.cover_style,
        cover_text=payload.cover_text,
    )
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


# --- Share / public access --------------------------------------------------


def _share_to_out(share: EpisodeShare, has_cover: bool) -> EpisodeShareOut:
    return EpisodeShareOut(
        token=share.token,
        public_url=f"/share/episode/{share.token}",
        embed_url=f"/embed/episode/{share.token}",
        audio_url=f"/api/public/episodes/{share.token}/audio.wav",
        cover_url=f"/api/public/episodes/{share.token}/cover.png" if has_cover else None,
        created_at=share.created_at,
    )


@router.get("/episodes/{episode_id}/share", response_model=EpisodeShareOut | None)
def get_episode_share(
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EpisodeShareOut | None:
    ep = _load_episode(db, episode_id, current_user)
    share = db.execute(
        select(EpisodeShare).where(EpisodeShare.episode_id == ep.id)
    ).scalar_one_or_none()
    if share is None:
        return None
    return _share_to_out(share, has_cover=ep.cover_file_id is not None)


@router.post(
    "/episodes/{episode_id}/share",
    response_model=EpisodeShareOut,
    status_code=201,
)
def create_episode_share(
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EpisodeShareOut:
    ep = _load_episode(db, episode_id, current_user)
    if ep.status != "ready":
        raise HTTPException(
            status_code=400, detail="Episode is not ready yet."
        )
    existing = db.execute(
        select(EpisodeShare).where(EpisodeShare.episode_id == ep.id)
    ).scalar_one_or_none()
    if existing is not None:
        return _share_to_out(existing, has_cover=ep.cover_file_id is not None)
    share = EpisodeShare(episode_id=ep.id)
    db.add(share)
    db.commit()
    db.refresh(share)
    return _share_to_out(share, has_cover=ep.cover_file_id is not None)


@router.delete(
    "/episodes/{episode_id}/share",
    status_code=204,
    response_class=Response,
)
def revoke_episode_share(
    episode_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_episode(db, episode_id, current_user)
    db.execute(
        delete(EpisodeShare).where(EpisodeShare.episode_id == ep.id)
    )
    db.commit()
    return Response(status_code=204)


# --- Playlist from tag ------------------------------------------------------


@router.post(
    "/playlists/from-tag",
    response_model=PlaylistOut,
    status_code=201,
)
def create_playlist_from_tag(
    payload: FromTagRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistOut:
    from app.models.tag import CardTag, Tag

    tag_name = payload.tag_name.strip().lower()
    if not tag_name:
        raise HTTPException(status_code=400, detail="tag_name required")

    tag = db.execute(
        select(Tag).where(Tag.user_id == current_user.id, Tag.name == tag_name)
    ).scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=404, detail=f"Tag '{tag_name}' not found")

    # Build the set of tag IDs to include — root + descendants if requested.
    target_tag_ids: set[UUID] = {tag.id}
    if payload.include_subtags:
        # BFS via parent_id.
        all_user_tags = db.execute(
            select(Tag).where(Tag.user_id == current_user.id)
        ).scalars().all()
        children_by_parent: dict[UUID, list[Tag]] = {}
        for t in all_user_tags:
            if t.parent_id is None:
                continue
            children_by_parent.setdefault(t.parent_id, []).append(t)
        queue = [tag]
        while queue:
            current = queue.pop(0)
            for child in children_by_parent.get(current.id, []):
                if child.id in target_tag_ids:
                    continue
                target_tag_ids.add(child.id)
                queue.append(child)

    cards = db.execute(
        select(Card)
        .join(CardTag, CardTag.card_id == Card.id)
        .where(
            CardTag.tag_id.in_(target_tag_ids),
            Card.user_id == current_user.id,
            Card.status == "completed",
        )
        .order_by(Card.created_at.asc())
        .distinct()
    ).scalars().all()

    if not cards:
        raise HTTPException(
            status_code=400, detail=f"No completed cards under tag '{tag_name}'"
        )

    pl = PodcastPlaylist(
        user_id=current_user.id,
        name=payload.name or f"#{tag_name}",
        description=f"Auto-generated from tag '{tag_name}'"
        + (" (incl. sub-tags)" if payload.include_subtags else ""),
    )
    db.add(pl)
    db.flush()
    for idx, card in enumerate(cards, start=1):
        db.add(
            PodcastPlaylistCard(playlist_id=pl.id, card_id=card.id, position=idx)
        )
    db.commit()
    db.refresh(pl)
    return PlaylistOut(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        created_at=pl.created_at,
        card_count=len(cards),
        has_draft=False,
    )


# --- Public unauthenticated endpoints ---------------------------------------

public_router = APIRouter(prefix="/public/episodes", tags=["public-episodes"])


def _resolve_share(db: Session, token: str) -> tuple[EpisodeShare, PodcastEpisode]:
    share = db.execute(
        select(EpisodeShare).where(EpisodeShare.token == token)
    ).scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")
    ep = db.get(PodcastEpisode, share.episode_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Episode missing")
    return share, ep


@public_router.get("/{token}", response_model=PublicEpisodeOut)
def public_episode(token: str, db: Session = Depends(get_db)) -> PublicEpisodeOut:
    _share, ep = _resolve_share(db, token)
    if ep.status != "ready":
        raise HTTPException(status_code=404, detail="Episode not ready")
    return PublicEpisodeOut(
        title=ep.title,
        voice=ep.voice,
        narrative_text=ep.narrative_text,
        audio_url=f"/api/public/episodes/{token}/audio.wav",
        cover_url=f"/api/public/episodes/{token}/cover.png" if ep.cover_file_id else None,
        created_at=ep.created_at,
    )


@public_router.get("/{token}/audio.wav")
def public_episode_audio(token: str, db: Session = Depends(get_db)) -> Response:
    _share, ep = _resolve_share(db, token)
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
            "Cache-Control": "public, max-age=3600",
        },
    )


@public_router.get("/{token}/cover.png")
def public_episode_cover(token: str, db: Session = Depends(get_db)) -> Response:
    _share, ep = _resolve_share(db, token)
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
            "Cache-Control": "public, max-age=86400",
        },
    )
