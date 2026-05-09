"""APScheduler wiring for periodic feed polling.

Started in `main.py` lifespan. Runs every `FEED_POLL_INTERVAL_MIN`
minutes and walks every active feed in series. Stays in-process — for
multi-worker deployments the scheduler should be moved to a single
dedicated worker, but for self-hosted single-process Mindshift this is
the simplest thing that works.
"""

from __future__ import annotations

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.feeds import poll_all_due_feeds

logger = logging.getLogger(__name__)

# Pulled from env so a slow VPS can throttle. Default 30 min keeps the
# poll rate friendly even for noisy news feeds without flooding the
# library.
FEED_POLL_INTERVAL_MIN = int(os.environ.get("FEED_POLL_INTERVAL_MIN", "30"))

_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> BackgroundScheduler:
    """Start the singleton scheduler. Idempotent — safe to call twice
    during reloader-driven restarts."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(
        poll_all_due_feeds,
        "interval",
        minutes=FEED_POLL_INTERVAL_MIN,
        # Run a few seconds after startup to fill the initial state without
        # blocking application startup.
        next_run_time=None,
        id="poll_all_feeds",
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    logger.info(
        "Feed scheduler started — polling every %s minutes", FEED_POLL_INTERVAL_MIN
    )
    _scheduler = sched
    return sched


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Feed scheduler stopped")
    _scheduler = None
