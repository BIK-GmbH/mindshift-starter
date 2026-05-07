"""Spaced-repetition scheduling — simplified SM-2-like algorithm.

State per question lives on `quiz_questions` (interval_days, lapses, stage, next_due_at,
last_reviewed_at). `review_events` keeps the immutable history.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

VALID_RATINGS = ("again", "hard", "good", "easy")
MAX_INTERVAL_DAYS = 365.0
LEARNING_INTERVAL_DAYS = 10 / 1440  # ~10 minutes


@dataclass(slots=True)
class ScheduleUpdate:
    interval_days: float
    next_due_at: datetime
    stage: str
    lapses: int


def schedule(
    rating: str,
    *,
    current_interval_days: float,
    current_lapses: int,
    now: datetime | None = None,
) -> ScheduleUpdate:
    """Compute the next review state from a rating and the current question state.

    Stages:
      new        — never reviewed
      learning   — recently failed (interval < 1 day)
      practiced  — 1–7 days
      confident  — 7–30 days
      mastered   — > 30 days
    """
    if rating not in VALID_RATINGS:
        raise ValueError(f"Unknown rating '{rating}'")

    now = now or datetime.now(tz=timezone.utc)
    interval = max(0.0, current_interval_days)
    lapses = current_lapses

    if rating == "again":
        new_interval = LEARNING_INTERVAL_DAYS
        lapses += 1
    elif interval < 0.5:
        # First successful review (treats anything below half a day as fresh).
        new_interval = {"hard": 1.0, "good": 1.0, "easy": 4.0}[rating]
    else:
        factor = {"hard": 1.2, "good": 2.5, "easy": 4.0}[rating]
        new_interval = interval * factor

    new_interval = min(new_interval, MAX_INTERVAL_DAYS)
    next_due_at = now + timedelta(days=new_interval)

    return ScheduleUpdate(
        interval_days=new_interval,
        next_due_at=next_due_at,
        stage=stage_from_interval(new_interval),
        lapses=lapses,
    )


def stage_from_interval(interval_days: float) -> str:
    if interval_days <= 0:
        return "new"
    if interval_days < 1:
        return "learning"
    if interval_days < 7:
        return "practiced"
    if interval_days < 30:
        return "confident"
    return "mastered"
