from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.learning_session import SESSION_GAP_MINUTES, LearningSession
from app.models.quiz import QuizQuestion, ReviewEvent
from app.models.source import Source
from app.models.user import User
from app.schemas.review import (
    ActivityDay,
    AnswerRequest,
    AnswerResponse,
    LearningSessionItem,
    ReviewQueueItem,
    ReviewStats,
    SessionDetail,
    SessionEventOut,
)
from app.services.scheduling import schedule, stage_from_interval

router = APIRouter(prefix="/review", tags=["review"])


def _bucket_session(db: Session, user_id: UUID, now: datetime, was_correct: bool) -> LearningSession:
    """Return the session this answer belongs to.

    Auto-bucketing rule: if the user's most recent session ended within
    `SESSION_GAP_MINUTES`, append to it; otherwise open a new one.
    """
    cutoff = now - timedelta(minutes=SESSION_GAP_MINUTES)
    latest = db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == user_id, LearningSession.ended_at >= cutoff)
        .order_by(LearningSession.ended_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest is None:
        latest = LearningSession(
            user_id=user_id,
            started_at=now,
            ended_at=now,
            event_count=1,
            correct_count=1 if was_correct else 0,
        )
        db.add(latest)
        db.flush()
    else:
        latest.ended_at = now
        latest.event_count = (latest.event_count or 0) + 1
        if was_correct:
            latest.correct_count = (latest.correct_count or 0) + 1
    return latest


@router.get("/queue", response_model=list[ReviewQueueItem])
def review_queue(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ReviewQueueItem]:
    now = datetime.now(tz=timezone.utc)
    stmt = (
        select(QuizQuestion, Card, Source.external_id)
        .join(Card, Card.id == QuizQuestion.card_id)
        .outerjoin(Source, Source.id == Card.source_id)
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
            card_thumbnail_url=card.thumbnail_url,
            card_source_type=card.source_type,
            card_external_id=external_id,
            question=q.question,
            answer=q.answer,
            question_type=q.question_type,
            difficulty=q.difficulty,
            choices_json=q.choices_json,
            stage=q.stage,
            interval_days=q.interval_days,
            lapses=q.lapses,
            last_reviewed_at=q.last_reviewed_at,
            next_due_at=q.next_due_at,
            created_at=q.created_at,
        )
        for q, card, external_id in rows
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

    was_correct = payload.rating in {"good", "easy"}
    session = _bucket_session(db, current_user.id, now, was_correct)
    db.add(
        ReviewEvent(
            question_id=question.id,
            user_id=current_user.id,
            rating=payload.rating,
            reviewed_at=now,
            next_due_at=update.next_due_at,
            stage=update.stage,
            interval_days=int(round(update.interval_days)),
            session_id=session.id,
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


@router.get("/sessions", response_model=list[LearningSessionItem])
def list_sessions(
    limit: int = Query(default=200, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LearningSessionItem]:
    rows = db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == current_user.id)
        .order_by(LearningSession.ended_at.desc())
        .limit(limit)
    ).scalars().all()
    return [
        LearningSessionItem(
            id=s.id,
            started_at=s.started_at,
            ended_at=s.ended_at,
            event_count=s.event_count,
            correct_count=s.correct_count,
        )
        for s in rows
    ]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def session_detail(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SessionDetail:
    session = db.execute(
        select(LearningSession).where(
            LearningSession.id == session_id,
            LearningSession.user_id == current_user.id,
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    rows = db.execute(
        select(ReviewEvent, QuizQuestion, Card)
        .join(QuizQuestion, QuizQuestion.id == ReviewEvent.question_id)
        .join(Card, Card.id == QuizQuestion.card_id)
        .where(ReviewEvent.session_id == session_id)
        .order_by(ReviewEvent.reviewed_at.asc())
    ).all()

    events = [
        SessionEventOut(
            id=ev.id,
            reviewed_at=ev.reviewed_at,
            rating=ev.rating,
            stage=ev.stage,
            interval_days=ev.interval_days,
            question_id=q.id,
            question=q.question,
            answer=q.answer,
            card_id=card.id,
            card_title=card.title,
        )
        for ev, q, card in rows
    ]

    return SessionDetail(
        id=session.id,
        started_at=session.started_at,
        ended_at=session.ended_at,
        event_count=session.event_count,
        correct_count=session.correct_count,
        events=events,
    )


@router.get("/activity", response_model=list[ActivityDay])
def review_activity(
    days: int = Query(default=365, ge=1, le=730),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActivityDay]:
    """Per-day answer counts for the last `days` days, UTC bucket."""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    day_col = func.to_char(func.date_trunc("day", ReviewEvent.reviewed_at), "YYYY-MM-DD")
    correct_expr = func.sum(case((ReviewEvent.rating.in_(("good", "easy")), 1), else_=0))
    rows = db.execute(
        select(day_col.label("day"), func.count().label("c"), correct_expr.label("ok"))
        .where(ReviewEvent.user_id == current_user.id)
        .where(ReviewEvent.reviewed_at >= cutoff)
        .group_by("day")
        .order_by("day")
    ).all()
    return [ActivityDay(date=r.day, count=int(r.c or 0), correct=int(r.ok or 0)) for r in rows]
