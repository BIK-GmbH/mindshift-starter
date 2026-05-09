from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.feed import Feed
from app.models.user import User
from app.schemas.feed import FeedCreate, FeedOut, FeedRefreshResult, FeedUpdate
from app.services.feeds import poll_feed

router = APIRouter(prefix="/feeds", tags=["feeds"])


@router.get("", response_model=list[FeedOut])
def list_feeds(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FeedOut]:
    rows = db.execute(
        select(Feed).where(Feed.user_id == current_user.id).order_by(Feed.created_at.desc())
    ).scalars().all()
    return [FeedOut.model_validate(r) for r in rows]


@router.post("", response_model=FeedOut, status_code=status.HTTP_201_CREATED)
def create_feed(
    payload: FeedCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedOut:
    url = str(payload.feed_url)
    # Reject duplicates per user — same URL twice is always a mistake.
    existing = db.execute(
        select(Feed).where(Feed.user_id == current_user.id, Feed.feed_url == url)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Feed already subscribed")

    feed = Feed(
        user_id=current_user.id,
        feed_url=url,
        title=(payload.title or "").strip(),
        is_active=True,
    )
    db.add(feed)
    db.commit()
    db.refresh(feed)

    # Kick off an immediate poll so the user sees items within seconds
    # rather than waiting for the next scheduler tick.
    background_tasks.add_task(poll_feed, feed.id)

    return FeedOut.model_validate(feed)


@router.patch("/{feed_id}", response_model=FeedOut)
def update_feed(
    feed_id: UUID,
    payload: FeedUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedOut:
    feed = db.get(Feed, feed_id)
    if feed is None or feed.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Feed not found")
    if payload.title is not None:
        feed.title = payload.title.strip()
    if payload.is_active is not None:
        feed.is_active = payload.is_active
    db.commit()
    db.refresh(feed)
    return FeedOut.model_validate(feed)


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(
    feed_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    feed = db.get(Feed, feed_id)
    if feed is None or feed.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Feed not found")
    db.delete(feed)
    db.commit()


@router.post("/{feed_id}/refresh", response_model=FeedRefreshResult)
def refresh_feed(
    feed_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedRefreshResult:
    feed = db.get(Feed, feed_id)
    if feed is None or feed.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Feed not found")
    # Synchronous so the caller sees the queued count immediately. The
    # poll itself is bounded (MAX_NEW_PER_POLL) so it can't take long.
    summary = poll_feed(feed_id)
    return FeedRefreshResult(**summary)
