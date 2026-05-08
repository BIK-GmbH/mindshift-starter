"""Idempotent backfill of `learning_sessions` from existing `review_events`.

Walks every user's events in chronological order. Whenever the gap to the
previous event exceeds `SESSION_GAP_MINUTES`, a new session row is created.
Each event's `session_id` is set so the post-backfill state matches what the
auto-bucket logic in `submit_answer` would have produced live.

Safe to re-run: events that already have `session_id` are skipped.

Run from the backend/ directory after sourcing the project .env:

    set -a; source ../.env; set +a
    .venv/bin/python -m app.scripts.backfill_learning_sessions
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.learning_session import SESSION_GAP_MINUTES, LearningSession
from app.models.quiz import ReviewEvent


def _backfill_user(db: Session, user_id, events: list[ReviewEvent]) -> int:
    events.sort(key=lambda e: e.reviewed_at)
    sessions_created = 0
    current: LearningSession | None = None
    gap = timedelta(minutes=SESSION_GAP_MINUTES)

    for ev in events:
        was_correct = ev.rating in {"good", "easy"}
        if current is None or ev.reviewed_at - current.ended_at > gap:
            current = LearningSession(
                user_id=user_id,
                started_at=ev.reviewed_at,
                ended_at=ev.reviewed_at,
                event_count=1,
                correct_count=1 if was_correct else 0,
            )
            db.add(current)
            db.flush()
            sessions_created += 1
        else:
            current.ended_at = ev.reviewed_at
            current.event_count += 1
            if was_correct:
                current.correct_count += 1
        ev.session_id = current.id

    return sessions_created


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill learning_sessions from review_events.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without writing.")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        events = db.execute(
            select(ReviewEvent).where(ReviewEvent.session_id.is_(None))
        ).scalars().all()

        if not events:
            print("All events already have a session_id — nothing to do.")
            return 0

        per_user: dict = defaultdict(list)
        for ev in events:
            per_user[ev.user_id].append(ev)

        print(f"Backfilling {len(events)} events across {len(per_user)} user(s).")

        if args.dry_run:
            for user_id, user_events in per_user.items():
                print(f"  user {user_id}: {len(user_events)} events")
            print("(dry-run — no rows written)")
            return 0

        total_sessions = 0
        for user_id, user_events in per_user.items():
            count = _backfill_user(db, user_id, user_events)
            total_sessions += count
            print(f"  user {user_id}: {len(user_events)} events → {count} sessions")

        db.commit()
        print(f"\nDone — created {total_sessions} sessions.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
