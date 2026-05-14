"""YouTube channel subscriptions — discovery, subscribe, browse, save.

All endpoints under `/api/channels`. Polling itself happens in
`services.channel_scheduler`; this router only exposes user-driven
actions (subscribe / unsubscribe / patch / browse / save / refresh).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.card import Card
from app.models.channel_subscription import ChannelSubscription
from app.models.channel_video import ChannelVideo
from app.models.channel_video_pop_cache import ChannelVideoPopCache
from app.models.user import User
from app.schemas.channel import (
    ChannelBulkSaveResult,
    ChannelPatchIn,
    ChannelRefreshResult,
    ChannelResolveIn,
    ChannelSaveResult,
    ChannelSearchResultOut,
    ChannelSubscribeIn,
    ChannelSubscriptionOut,
    ChannelSuggestionOut,
    ChannelVideoListOut,
    ChannelVideoOut,
)
from app.services.channel_polling import (
    _create_card_for_video,
    _drain_pending_in_background,
    _run_single_ingestion,
    poll_channel,
    unread_count as _unread_count,
)
from app.services.channel_search import (
    library_suggestions,
    popular_videos,
    resolve_channel,
    search_channels,
)

logger = logging.getLogger(__name__)

POPULAR_CACHE_TTL_HOURS = 24

router = APIRouter(prefix="/channels", tags=["channels"])


# ---------------------------------------------------------------------------
# Helpers


def _api_enabled() -> bool:
    return bool(get_settings().youtube_api_key.strip())


def _to_subscription_out(
    sub: ChannelSubscription, *, unread: int
) -> ChannelSubscriptionOut:
    return ChannelSubscriptionOut(
        id=sub.id,
        channel_id=sub.channel_id,
        handle=sub.handle,
        title=sub.title or sub.channel_id,
        thumbnail_url=sub.thumbnail_url,
        description=sub.description,
        subscriber_count=sub.subscriber_count,
        ingest_mode=sub.ingest_mode,  # type: ignore[arg-type]
        exclude_shorts=sub.exclude_shorts,
        unread_count=unread,
        items_ingested=sub.items_ingested or 0,
        last_polled_at=sub.last_polled_at,
        last_success_at=sub.last_success_at,
        last_error=sub.last_error,
        created_at=sub.created_at,
    )


def _get_owned_sub(
    db: Session, user: User, sub_id: UUID
) -> ChannelSubscription:
    sub = db.get(ChannelSubscription, sub_id)
    if sub is None or sub.user_id != user.id:
        raise HTTPException(status_code=404, detail="Channel not found")
    return sub


# ---------------------------------------------------------------------------
# Discovery


@router.get("/search", response_model=list[ChannelSearchResultOut])
def search_endpoint(
    q: str = Query(min_length=1, max_length=200),
    current_user: User = Depends(get_current_user),
) -> list[ChannelSearchResultOut]:
    if not _api_enabled():
        return []
    results = search_channels(q)
    return [ChannelSearchResultOut(**r.as_dict()) for r in results]


@router.post("/resolve", response_model=ChannelSearchResultOut)
def resolve_endpoint(
    payload: ChannelResolveIn,
    current_user: User = Depends(get_current_user),
) -> ChannelSearchResultOut:
    if not _api_enabled():
        raise HTTPException(
            status_code=503,
            detail="YouTube API key is not configured on the server",
        )
    resolved = resolve_channel(payload.url_or_handle)
    if resolved is None:
        raise HTTPException(
            status_code=404,
            detail="Could not resolve a YouTube channel from that input",
        )
    return ChannelSearchResultOut(**resolved.as_dict())


@router.get("/suggestions", response_model=list[ChannelSuggestionOut])
def suggestions_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChannelSuggestionOut]:
    rows = library_suggestions(db, current_user.id)
    return [ChannelSuggestionOut(**r) for r in rows]


# ---------------------------------------------------------------------------
# Subscription CRUD


@router.get("", response_model=list[ChannelSubscriptionOut])
def list_channels(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChannelSubscriptionOut]:
    subs = db.execute(
        select(ChannelSubscription)
        .where(ChannelSubscription.user_id == current_user.id)
        .order_by(ChannelSubscription.title.asc(), ChannelSubscription.created_at.desc())
    ).scalars().all()
    if not subs:
        return []

    # Single grouped query for unread counts.
    unread_rows = dict(
        db.execute(
            select(
                ChannelVideo.subscription_id,
                func.count(ChannelVideo.id),
            )
            .where(
                ChannelVideo.subscription_id.in_([s.id for s in subs]),
                ChannelVideo.read_at.is_(None),
            )
            .group_by(ChannelVideo.subscription_id)
        ).all()
    )
    return [
        _to_subscription_out(s, unread=int(unread_rows.get(s.id, 0)))
        for s in subs
    ]


@router.post(
    "",
    response_model=ChannelSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
def subscribe_channel(
    payload: ChannelSubscribeIn,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelSubscriptionOut:
    channel_id = payload.channel_id.strip()
    if not channel_id:
        raise HTTPException(status_code=400, detail="channel_id is required")

    existing = db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.user_id == current_user.id,
            ChannelSubscription.channel_id == channel_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _to_subscription_out(
            existing, unread=_unread_count(db, existing.id)
        )

    resolved = resolve_channel(channel_id) if _api_enabled() else None
    sub = ChannelSubscription(
        user_id=current_user.id,
        channel_id=channel_id,
        handle=(resolved.handle if resolved else None),
        title=(resolved.title if resolved else channel_id),
        thumbnail_url=(resolved.thumbnail_url if resolved else None),
        description=(resolved.description if resolved else None),
        subscriber_count=(resolved.subscriber_count if resolved else None),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # Background first pull — populate the inbox quickly. Critically:
    # `allow_auto_ingest=False` so subscribing to a channel with auto-mode
    # already on does NOT silently ingest the 15 latest videos.
    background_tasks.add_task(poll_channel, sub.id, allow_auto_ingest=False)

    return _to_subscription_out(sub, unread=0)


@router.patch("/{sub_id}", response_model=ChannelSubscriptionOut)
def patch_channel(
    sub_id: UUID,
    payload: ChannelPatchIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelSubscriptionOut:
    sub = _get_owned_sub(db, current_user, sub_id)
    if payload.ingest_mode is not None:
        sub.ingest_mode = payload.ingest_mode
    if payload.exclude_shorts is not None:
        sub.exclude_shorts = payload.exclude_shorts
    db.commit()
    db.refresh(sub)
    return _to_subscription_out(sub, unread=_unread_count(db, sub.id))


@router.delete(
    "/{sub_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
def delete_channel(
    sub_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    sub = _get_owned_sub(db, current_user, sub_id)
    db.delete(sub)
    db.commit()


# ---------------------------------------------------------------------------
# Browse


@router.get("/{sub_id}/videos", response_model=ChannelVideoListOut)
def list_videos(
    sub_id: UUID,
    tab: str = Query(default="latest"),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelVideoListOut:
    sub = _get_owned_sub(db, current_user, sub_id)
    if tab not in {"latest", "popular", "saved"}:
        raise HTTPException(status_code=400, detail="Invalid tab")

    if tab == "latest":
        total = int(
            db.execute(
                select(func.count(ChannelVideo.id)).where(
                    ChannelVideo.subscription_id == sub.id
                )
            ).scalar_one()
            or 0
        )
        rows = db.execute(
            select(ChannelVideo)
            .where(ChannelVideo.subscription_id == sub.id)
            .order_by(
                ChannelVideo.published_at.desc().nullslast(),
                ChannelVideo.discovered_at.desc(),
            )
            .offset(offset)
            .limit(limit)
        ).scalars().all()
        return ChannelVideoListOut(
            tab="latest",
            total=total,
            items=[ChannelVideoOut.model_validate(r) for r in rows],
        )

    if tab == "saved":
        total = int(
            db.execute(
                select(func.count(ChannelVideo.id)).where(
                    ChannelVideo.subscription_id == sub.id,
                    ChannelVideo.saved_card_id.is_not(None),
                )
            ).scalar_one()
            or 0
        )
        rows = db.execute(
            select(ChannelVideo)
            .where(
                ChannelVideo.subscription_id == sub.id,
                ChannelVideo.saved_card_id.is_not(None),
            )
            .order_by(ChannelVideo.published_at.desc().nullslast())
            .offset(offset)
            .limit(limit)
        ).scalars().all()
        return ChannelVideoListOut(
            tab="saved",
            total=total,
            items=[ChannelVideoOut.model_validate(r) for r in rows],
        )

    # tab == "popular" — cache-first.
    cache = db.get(ChannelVideoPopCache, sub.id)
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=POPULAR_CACHE_TTL_HOURS)
    use_cache = False
    if cache is not None:
        fetched = cache.fetched_at
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        if fetched > cutoff:
            use_cache = True

    if use_cache and cache is not None:
        payload: list[dict[str, Any]] = list(cache.payload or [])
    else:
        payload = popular_videos(sub.channel_id)
        if payload:
            if cache is None:
                cache = ChannelVideoPopCache(
                    subscription_id=sub.id,
                    payload=payload,
                    fetched_at=datetime.now(tz=timezone.utc),
                )
                db.add(cache)
            else:
                cache.payload = payload
                cache.fetched_at = datetime.now(tz=timezone.utc)
            db.commit()

    # Annotate which popular videos are already saved-as-cards, so the
    # UI can show "Open card" instead of "Save".
    video_ids = [p["video_id"] for p in payload if p.get("video_id")]
    saved_map: dict[str, UUID] = {}
    if video_ids:
        # ChannelVideo rows might exist (auto-ingested) — use those.
        cv_rows = db.execute(
            select(ChannelVideo.video_id, ChannelVideo.saved_card_id)
            .where(
                ChannelVideo.subscription_id == sub.id,
                ChannelVideo.video_id.in_(video_ids),
                ChannelVideo.saved_card_id.is_not(None),
            )
        ).all()
        for vid, cid in cv_rows:
            saved_map[vid] = cid

    items: list[ChannelVideoOut] = []
    for p in payload[offset : offset + limit]:
        items.append(
            ChannelVideoOut(
                video_id=p["video_id"],
                title=p.get("title") or "",
                thumbnail_url=p.get("thumbnail_url"),
                duration_seconds=p.get("duration_seconds"),
                published_at=p.get("published_at"),
                is_short=bool(p.get("is_short")),
                read_at=None,
                saved_card_id=saved_map.get(p["video_id"]),
                view_count=p.get("view_count"),
            )
        )
    return ChannelVideoListOut(tab="popular", total=len(payload), items=items)


# ---------------------------------------------------------------------------
# Video actions


@router.post(
    "/{sub_id}/videos/{video_id}/save",
    response_model=ChannelSaveResult,
)
def save_video(
    sub_id: UUID,
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelSaveResult:
    """Save one video as a Card. If it's already a card, returns that."""
    sub = _get_owned_sub(db, current_user, sub_id)
    row = db.execute(
        select(ChannelVideo).where(
            ChannelVideo.subscription_id == sub.id,
            ChannelVideo.video_id == video_id,
        )
    ).scalar_one_or_none()

    # Popular-tab videos may not have an inbox row yet. Create one on-
    # the-fly so the JOINed responses ("Saved" tab) still find them.
    if row is None:
        row = ChannelVideo(
            subscription_id=sub.id,
            video_id=video_id,
            title=f"YouTube {video_id}",
            discovered_at=datetime.now(tz=timezone.utc),
        )
        db.add(row)
        db.flush()

    card_id, job_id = _create_card_for_video(db, current_user.id, row)
    db.commit()
    # job_id is None when the video was already a card — nothing to do.
    if job_id is not None:
        _run_single_ingestion(card_id, job_id, video_id)
    return ChannelSaveResult(card_id=card_id)


@router.post(
    "/{sub_id}/save-all-unread",
    response_model=ChannelBulkSaveResult,
)
def save_all_unread(
    sub_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelBulkSaveResult:
    """Persist all unread inbox rows as cards and drain the ingestion
    sequentially in one background thread (4 s between YouTube items)
    so the transcript API doesn't IP-block us when the user bulk-saves
    a fresh channel."""
    sub = _get_owned_sub(db, current_user, sub_id)

    unread_rows = db.execute(
        select(ChannelVideo)
        .where(
            ChannelVideo.subscription_id == sub.id,
            ChannelVideo.read_at.is_(None),
        )
        .order_by(ChannelVideo.published_at.asc().nullslast())
    ).scalars().all()

    pending: list[tuple[UUID, UUID, str]] = []
    for row in unread_rows:
        if sub.exclude_shorts and row.is_short:
            continue
        try:
            card_id, job_id = _create_card_for_video(db, current_user.id, row)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "save-all-unread row creation failed for %s: %s",
                row.video_id,
                exc,
            )
            continue
        if job_id is not None:
            pending.append((card_id, job_id, row.video_id))
    sub.items_ingested = (sub.items_ingested or 0) + len(pending)
    db.commit()
    _drain_pending_in_background(pending)
    return ChannelBulkSaveResult(queued=len(pending))


@router.post(
    "/{sub_id}/mark-read",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def mark_read(
    sub_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    sub = _get_owned_sub(db, current_user, sub_id)
    now = datetime.now(tz=timezone.utc)
    db.execute(
        ChannelVideo.__table__.update()
        .where(
            ChannelVideo.subscription_id == sub.id,
            ChannelVideo.read_at.is_(None),
        )
        .values(read_at=now)
    )
    db.commit()


@router.post("/{sub_id}/refresh", response_model=ChannelRefreshResult)
def refresh_channel(
    sub_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelRefreshResult:
    sub = _get_owned_sub(db, current_user, sub_id)
    summary = poll_channel(sub.id, allow_auto_ingest=True)
    return ChannelRefreshResult(**summary)
