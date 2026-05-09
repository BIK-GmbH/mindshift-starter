from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.path import Path, PathCard
from app.models.path_progress import PathProgress
from app.models.quiz import QuizQuestion
from app.models.user import User
from app.schemas.path import (
    AddCardsRequest,
    PathCardItem,
    PathCreate,
    PathDetail,
    PathListItem,
    PathQuiz,
    PathQuizQuestion,
    PathUpdate,
    ProgressOut,
    ProgressUpdate,
    PublicPathOut,
    ReorderRequest,
    UpdateLessonRequest,
)
from app.services.paths import next_position, renumber_positions, slugify, unique_slug_for

router = APIRouter(prefix="/paths", tags=["paths"])


# --- Owner CRUD --------------------------------------------------------------


def _path_to_list_item(
    db: Session, path: Path, progress: PathProgress | None = None
) -> PathListItem:
    count = db.execute(
        select(func.count(PathCard.path_id)).where(PathCard.path_id == path.id)
    ).scalar_one()
    return PathListItem(
        id=path.id,
        title=path.title,
        slug=path.slug,
        description_md=path.description_md,
        cover_url=path.cover_url,
        is_public=path.is_public,
        card_count=int(count or 0),
        created_at=path.created_at,
        updated_at=path.updated_at,
        progress_position=progress.current_position if progress else None,
        progress_completed_at=progress.completed_at if progress else None,
    )


def _path_to_detail(db: Session, path: Path) -> PathDetail:
    """Detail view — joins path_cards with cards so the frontend has
    everything it needs to render the editor / player without a second
    request."""
    rows = db.execute(
        select(PathCard, Card)
        .join(Card, Card.id == PathCard.card_id)
        .where(PathCard.path_id == path.id)
        .order_by(PathCard.position)
    ).all()
    items = [
        PathCardItem(
            card_id=card.id,
            position=pc.position,
            lesson_md=pc.lesson_md,
            title=card.title,
            source_type=card.source_type,
            status=card.status,
            thumbnail_url=card.thumbnail_url,
            concise_summary_md=card.concise_summary_md,
        )
        for pc, card in rows
    ]
    base = _path_to_list_item(db, path)
    return PathDetail(**base.model_dump(), cards=items)


def _get_owned_path(db: Session, path_id: UUID, user_id: UUID) -> Path:
    path = db.get(Path, path_id)
    if path is None or path.user_id != user_id:
        raise HTTPException(status_code=404, detail="Path not found")
    return path


@router.get("", response_model=list[PathListItem])
def list_paths(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PathListItem]:
    rows = (
        db.execute(
            select(Path).where(Path.user_id == current_user.id).order_by(Path.created_at.desc())
        )
        .scalars()
        .all()
    )
    # Single query for everyone's progress on these paths so the list
    # endpoint stays O(1) round-trips regardless of path count.
    progress_by_path: dict[UUID, PathProgress] = {
        pp.path_id: pp
        for pp in db.execute(
            select(PathProgress).where(
                PathProgress.user_id == current_user.id,
                PathProgress.path_id.in_([p.id for p in rows]) if rows else False,
            )
        ).scalars().all()
    }
    return [_path_to_list_item(db, p, progress_by_path.get(p.id)) for p in rows]


@router.post("", response_model=PathDetail, status_code=status.HTTP_201_CREATED)
def create_path(
    payload: PathCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    base = slugify(title)
    slug = unique_slug_for(db, current_user.id, base)
    path = Path(
        user_id=current_user.id,
        title=title,
        slug=slug,
        description_md=payload.description_md,
        is_public=False,
    )
    db.add(path)
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


@router.get("/{path_id}", response_model=PathDetail)
def get_path(
    path_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    path = _get_owned_path(db, path_id, current_user.id)
    return _path_to_detail(db, path)


@router.patch("/{path_id}", response_model=PathDetail)
def update_path(
    path_id: UUID,
    payload: PathUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    path = _get_owned_path(db, path_id, current_user.id)
    if payload.title is not None:
        new_title = payload.title.strip()
        if not new_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        path.title = new_title
    if payload.description_md is not None:
        path.description_md = payload.description_md
    if payload.cover_url is not None:
        path.cover_url = payload.cover_url or None
    if payload.is_public is not None:
        path.is_public = payload.is_public
    if payload.regenerate_slug:
        base = slugify(path.title)
        path.slug = unique_slug_for(db, current_user.id, base, existing_path_id=path.id)
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


@router.delete("/{path_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_path(
    path_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    path = _get_owned_path(db, path_id, current_user.id)
    db.delete(path)
    db.commit()


# --- Card membership ---------------------------------------------------------


@router.post("/{path_id}/cards", response_model=PathDetail, status_code=status.HTTP_201_CREATED)
def add_cards(
    path_id: UUID,
    payload: AddCardsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    """Append one or more cards to the end of the path. Skips cards
    that are already in this path (so the request is idempotent) and
    silently rejects cards the user doesn't own."""
    path = _get_owned_path(db, path_id, current_user.id)

    # Owner check on the cards in one query.
    owned_ids = set(
        db.execute(
            select(Card.id).where(Card.id.in_(payload.card_ids), Card.user_id == current_user.id)
        ).scalars().all()
    )
    if not owned_ids:
        raise HTTPException(status_code=400, detail="No accessible cards in request")

    existing_ids = set(
        db.execute(
            select(PathCard.card_id).where(PathCard.path_id == path.id)
        ).scalars().all()
    )

    pos = next_position(db, path.id)
    # Preserve the order the caller passed.
    for cid in payload.card_ids:
        if cid not in owned_ids or cid in existing_ids:
            continue
        db.add(PathCard(path_id=path.id, card_id=cid, position=pos))
        existing_ids.add(cid)
        pos += 1
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


@router.delete("/{path_id}/cards/{card_id}", response_model=PathDetail)
def remove_card(
    path_id: UUID,
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    path = _get_owned_path(db, path_id, current_user.id)
    row = db.execute(
        select(PathCard).where(PathCard.path_id == path.id, PathCard.card_id == card_id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Card not in this path")
    db.delete(row)
    db.flush()
    renumber_positions(db, path.id)
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


@router.patch("/{path_id}/reorder", response_model=PathDetail)
def reorder_cards(
    path_id: UUID,
    payload: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    """Replace the ordering with the given list. Must be a permutation of
    the path's current cards — extra or missing IDs are an error."""
    path = _get_owned_path(db, path_id, current_user.id)
    rows = db.execute(
        select(PathCard).where(PathCard.path_id == path.id)
    ).scalars().all()
    by_card = {pc.card_id: pc for pc in rows}
    if set(by_card.keys()) != set(payload.card_ids):
        raise HTTPException(
            status_code=400,
            detail="reorder list must match the path's current cards exactly",
        )
    for i, cid in enumerate(payload.card_ids):
        by_card[cid].position = i
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


@router.patch("/{path_id}/cards/{card_id}/lesson", response_model=PathDetail)
def update_lesson(
    path_id: UUID,
    card_id: UUID,
    payload: UpdateLessonRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathDetail:
    """Set/clear the lesson note for a single step."""
    path = _get_owned_path(db, path_id, current_user.id)
    row = db.execute(
        select(PathCard).where(PathCard.path_id == path.id, PathCard.card_id == card_id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Card not in this path")
    row.lesson_md = (payload.lesson_md or "").strip() or None
    db.commit()
    db.refresh(path)
    return _path_to_detail(db, path)


# --- Progress tracking -------------------------------------------------------


def _accessible_path(db: Session, path_id: UUID, user: User) -> Path:
    """A path is accessible to its owner unconditionally, and to anyone
    else only when public. Returns the path or raises 404."""
    path = db.get(Path, path_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Path not found")
    if path.user_id != user.id and not path.is_public:
        raise HTTPException(status_code=404, detail="Path not found")
    return path


@router.get("/{path_id}/progress", response_model=ProgressOut | None)
def get_progress(
    path_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressOut | None:
    path = _accessible_path(db, path_id, current_user)
    pp = db.execute(
        select(PathProgress).where(
            PathProgress.user_id == current_user.id,
            PathProgress.path_id == path_id,
        )
    ).scalar_one_or_none()
    if pp is None:
        return None
    total = db.execute(
        select(func.count(PathCard.path_id)).where(PathCard.path_id == path.id)
    ).scalar_one()
    return ProgressOut(
        current_position=pp.current_position,
        started_at=pp.started_at,
        completed_at=pp.completed_at,
        total=int(total or 0),
    )


@router.post("/{path_id}/progress", response_model=ProgressOut)
def update_progress(
    path_id: UUID,
    payload: ProgressUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressOut:
    """Record that the user navigated to `current_position` (0-based).

    Idempotent: re-sending the same position changes nothing. The stored
    position only ever advances — replaying earlier steps doesn't move
    the bookmark backwards. Reaching the last step stamps `completed_at`
    and bumps the path's `completion_count` exactly once."""
    path = _accessible_path(db, path_id, current_user)
    total = db.execute(
        select(func.count(PathCard.path_id)).where(PathCard.path_id == path.id)
    ).scalar_one()
    if total == 0:
        raise HTTPException(status_code=400, detail="Path has no steps")
    new_pos = max(0, min(int(payload.current_position), int(total) - 1))

    pp = db.execute(
        select(PathProgress).where(
            PathProgress.user_id == current_user.id,
            PathProgress.path_id == path_id,
        )
    ).scalar_one_or_none()
    if pp is None:
        pp = PathProgress(
            user_id=current_user.id,
            path_id=path_id,
            current_position=new_pos,
        )
        db.add(pp)
    else:
        # Don't move the bookmark backwards.
        pp.current_position = max(pp.current_position, new_pos)

    # Stamp completion exactly once. Bump path's count when it first
    # transitions to completed (so it remains accurate even if the user
    # later re-plays the path).
    if pp.completed_at is None and pp.current_position >= int(total) - 1:
        pp.completed_at = datetime.now(tz=timezone.utc)
        path.completion_count += 1

    db.commit()
    db.refresh(pp)
    return ProgressOut(
        current_position=pp.current_position,
        started_at=pp.started_at,
        completed_at=pp.completed_at,
        total=int(total),
    )


@router.get("/{path_id}/quiz", response_model=PathQuiz)
def get_path_quiz(
    path_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PathQuiz:
    """Aggregate quiz questions across every card in the path.

    Order: cards in path-position order, questions per card in their
    original order. The frontend may shuffle for the actual run; we
    return a stable order so re-asking is deterministic when needed.
    """
    path = _accessible_path(db, path_id, current_user)
    rows = db.execute(
        select(QuizQuestion, Card, PathCard)
        .join(PathCard, PathCard.card_id == QuizQuestion.card_id)
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(PathCard.path_id == path.id)
        .order_by(PathCard.position, QuizQuestion.created_at)
    ).all()
    questions = [
        PathQuizQuestion(
            id=q.id,
            card_id=q.card_id,
            card_title=card.title,
            card_position=pc.position,
            question=q.question,
            answer=q.answer,
            question_type=q.question_type,
            choices_json=q.choices_json,
        )
        for q, card, pc in rows
    ]
    return PathQuiz(path_id=path.id, path_title=path.title, questions=questions)


# --- Public read endpoint ----------------------------------------------------


public_router = APIRouter(prefix="/public/paths", tags=["paths-public"])


@public_router.get("/{username}/{slug}", response_model=PublicPathOut)
def get_public_path(
    username: str,
    slug: str,
    db: Session = Depends(get_db),
) -> PublicPathOut:
    """Unauthenticated read for a public path, addressed by the owner's
    username and the path's slug."""
    user = db.execute(
        select(User).where(User.username == username, User.public_profile.is_(True))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Path not found")

    path = db.execute(
        select(Path).where(Path.user_id == user.id, Path.slug == slug, Path.is_public.is_(True))
    ).scalar_one_or_none()
    if path is None:
        raise HTTPException(status_code=404, detail="Path not found")

    rows = db.execute(
        select(PathCard, Card)
        .join(Card, Card.id == PathCard.card_id)
        .where(PathCard.path_id == path.id)
        .order_by(PathCard.position)
    ).all()
    cards = [
        PathCardItem(
            card_id=card.id,
            position=pc.position,
            lesson_md=pc.lesson_md,
            title=card.title,
            source_type=card.source_type,
            status=card.status,
            thumbnail_url=card.thumbnail_url,
            concise_summary_md=card.concise_summary_md,
        )
        for pc, card in rows
    ]
    return PublicPathOut(
        title=path.title,
        slug=path.slug,
        description_md=path.description_md,
        cover_url=path.cover_url,
        author_username=user.username or "",
        cards=cards,
        created_at=path.created_at,
    )
