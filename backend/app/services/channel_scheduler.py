"""APScheduler wiring for periodic YouTube channel polling.

Runs in the same process as `feed_scheduler`; mounted from
`main.py` lifespan. Polls every `CHANNEL_POLL_INTERVAL_MIN` minutes and
walks each ChannelSubscription in sequence (idempotent — 304 responses
cost nothing).
"""

from __future__ import annotations

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.channel_polling import poll_all_due_channels

logger = logging.getLogger(__name__)

CHANNEL_POLL_INTERVAL_MIN = int(os.environ.get("CHANNEL_POLL_INTERVAL_MIN", "30"))

_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> BackgroundScheduler:
    """Idempotent — safe to call multiple times during reloader restarts."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(
        poll_all_due_channels,
        "interval",
        minutes=CHANNEL_POLL_INTERVAL_MIN,
        next_run_time=None,
        id="poll_all_channels",
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    logger.info(
        "Channel scheduler started — polling every %s minutes",
        CHANNEL_POLL_INTERVAL_MIN,
    )
    _scheduler = sched
    return sched


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Channel scheduler stopped")
    _scheduler = None
