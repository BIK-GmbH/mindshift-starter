"""On-startup recovery for async generation pipelines.

We use FastAPI BackgroundTasks (in-process) for podcast / audio /
translation generation. They survive client disconnects but NOT a
backend restart. After a restart, any rows still in `status='processing'`
are orphans — the worker that owned them is gone.

This module finds those orphans (older than `STUCK_THRESHOLD_MIN`) and
flips them to `status='failed'` with an explanatory error message, so
the user can re-trigger from the UI.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.db.session import SessionLocal
from app.models.card_audio import CardAudio
from app.models.card_translation import CardTranslation
from app.models.podcast import PodcastEpisode

STUCK_THRESHOLD_MIN = 5
STUCK_MESSAGE = (
    "Generation was interrupted (likely a backend restart). "
    "Click retry to run it again."
)


def reap_stuck_processing() -> dict[str, int]:
    """Mark orphaned processing rows as failed. Returns counts per table."""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(minutes=STUCK_THRESHOLD_MIN)
    counts: dict[str, int] = {}

    db = SessionLocal()
    try:
        # Three identical updates over three tables. SQLAlchemy 2 lets us
        # express each as a single bulk UPDATE.
        for label, model in (
            ("card_translations", CardTranslation),
            ("card_audio", CardAudio),
            ("podcast_episodes", PodcastEpisode),
        ):
            result = db.execute(
                update(model)
                .where(
                    model.status == "processing",
                    model.created_at < cutoff,
                )
                .values(status="failed", error_message=STUCK_MESSAGE)
            )
            counts[label] = result.rowcount or 0
        db.commit()
    finally:
        db.close()

    return counts
