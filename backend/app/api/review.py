from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.quiz import QuizQuestion, ReviewEvent
from app.models.user import User
from app.schemas.review import AnswerRequest, AnswerResponse, ReviewQueueItem, ReviewStats
from app.services.scheduling import schedule, stage_from_interval

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/queue", response_model=list[ReviewQueueItem])
def review_queue(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ReviewQueueItem]:
    now = datetime.now(tz=timezone.utc)
    stmt = (
        select(QuizQuestion, Card)
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(Card.user_id == current_user.id)
        .where(or_(QuizQuestion.next_due_at.is_(None), QuizQuestion.next_due_at <= now))
        .order_by(
            # New questions first (next_due_at IS NULL bubbles up), then earliest due.
            QuizQuestion.next_due_at.asc().nulls_first(),
            QuizQuestion.created_at.asc(),
        )
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    return [
        ReviewQueueItem(
            id=q.id,
            card_id=q.card_id,
            card_title=card.title,
            question=q.question,
            answer=q.answer,
            question_type=q.question_type,
            difficulty=q.difficulty,
            stage=q.stage,
            interval_days=q.interval_days,
            lapses=q.lapses,
            last_reviewed_at=q.last_reviewed_at,
            next_due_at=q.next_due_at,
            created_at=q.created_at,
        )
        for q, card in rows
    ]


@router.get("/stats", response_model=ReviewStats)
def review_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReviewStats:
    now = datetime.now(tz=timezone.utc)
    base = (
        select(QuizQuestion)
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(Card.user_id == current_user.id)
    )

    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    due_now = db.execute(
        select(func.count()).select_from(
            base.where(or_(QuizQuestion.next_due_at.is_(None), QuizQuestion.next_due_at <= now)).subquery()
        )
    ).scalar_one()

    counts: dict[str, int] = {"new": 0, "learning": 0, "practiced": 0, "confident": 0, "mastered": 0}
    rows = db.execute(
        select(QuizQuestion.stage, func.count())
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(Card.user_id == current_user.id)
        .group_by(QuizQuestion.stage)
    ).all()
    for stage, count in rows:
        counts[stage] = count

    return ReviewStats(total=total, due_now=due_now, **counts)


@router.post("/{question_id}/answer", response_model=AnswerResponse)
def submit_answer(
    question_id: UUID,
    payload: AnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnswerResponse:
    row = db.execute(
        select(QuizQuestion, Card)
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(QuizQuestion.id == question_id, Card.user_id == current_user.id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Question not found")
    question, _card = row

    now = datetime.now(tz=timezone.utc)
    update = schedule(
        payload.rating,
        current_interval_days=question.interval_days,
        current_lapses=question.lapses,
        now=now,
    )

    question.interval_days = update.interval_days
    question.next_due_at = update.next_due_at
    question.stage = update.stage
    question.lapses = update.lapses
    question.last_reviewed_at = now

    db.add(
        ReviewEvent(
            question_id=question.id,
            user_id=current_user.id,
            rating=payload.rating,
            reviewed_at=now,
            next_due_at=update.next_due_at,
            stage=update.stage,
            interval_days=int(round(update.interval_days)),
        )
    )
    db.commit()

    return AnswerResponse(
        question_id=question.id,
        rating=payload.rating,
        stage=update.stage,
        interval_days=update.interval_days,
        next_due_at=update.next_due_at,
        lapses=update.lapses,
    )
