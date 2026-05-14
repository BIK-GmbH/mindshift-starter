"""YouTube channel RSS polling + (optional) auto-ingestion.

Each `ChannelSubscription` is polled via its free Atom feed at
`youtube.com/feeds/videos.xml?channel_id=<UC...>`. New `<entry>` rows
become `ChannelVideo` inbox rows; when the subscription is in
`auto`-ingest mode, every non-short row also triggers the existing
`process_youtube_card` background pipeline so a card with transcript +
summary + embeddings is built end-to-end.

This module is invoked from three places:
  * `services.channel_scheduler.start_scheduler` — periodic background.
  * `api.channels.create_channel` — synchronous first pull.
  * `api.channels.refresh_channel` / `save_all_unread` — user-triggered.

`poll_channel(subscription_id, allow_auto_ingest=True)` is the single
public entry point. `allow_auto_ingest=False` is used for the *first*
pull right after subscription so the user doesn't get flooded with 15
auto-ingested cards on day zero.
"""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.channel_subscription import ChannelSubscription
from app.models.channel_video import ChannelVideo
from app.models.job import Job
from app.models.source import Source
from app.services.http_polling import conditional_fetch

logger = logging.getLogger(__name__)

# Hard cap on how many fresh entries we ingest from a single channel in
# one poll. YouTube's channel Atom feed carries at most 15 entries, so a
# cap of 20 effectively means "take everything the feed gives us" while
# still protecting against bogus feeds that fabricate hundreds of items.
# It must be ≥ feed size or we silently miss the freshest uploads when a
# new subscription is initialised.
MAX_NEW_PER_POLL = 20

# Atom namespaces used by YouTube's channel feeds.
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


@dataclass
class PolledVideo:
    video_id: str
    title: str
    thumbnail_url: str | None
    published_at: datetime | None
    is_short: bool


def feed_url_for(channel_id: str) -> str:
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


def poll_channel(
    subscription_id: UUID,
    *,
    allow_auto_ingest: bool = True,
) -> dict:
    """Poll one subscription. Returns a summary dict.

    Idempotent — re-running on an unchanged feed costs one 304 round-trip.
    Failures set `last_error` on the row and continue rather than raise,
    so a single bad channel never blocks the scheduler.
    """
    db = SessionLocal()
    summary = {"new_videos": 0, "queued_ingestion": 0, "error": None}
    try:
        sub = db.get(ChannelSubscription, subscription_id)
        if sub is None:
            return summary

        sub.last_polled_at = datetime.now(tz=timezone.utc)

        fetched = conditional_fetch(
            feed_url_for(sub.channel_id),
            etag=sub.last_etag,
            last_modified=sub.last_modified,
            accept="application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        )

        if fetched.status == "not_modified":
            sub.last_error = None
            sub.last_success_at = datetime.now(tz=timezone.utc)
            db.commit()
            return summary

        if fetched.status == "error" or fetched.body is None:
            sub.last_error = (fetched.error or "Unknown polling error")[:500]
            db.commit()
            summary["error"] = sub.last_error
            return summary

        try:
            entries = list(_parse_atom_entries(fetched.body))
        except Exception as exc:  # noqa: BLE001
            sub.last_error = f"Atom parse error: {exc}"[:500]
            db.commit()
            summary["error"] = sub.last_error
            return summary

        if fetched.etag:
            sub.last_etag = fetched.etag[:255]
        if fetched.last_modified:
            sub.last_modified = fetched.last_modified[:255]

        # Persist channel title from feed if we don't have one yet.
        # (`/api/channels` already persisted it during resolve, but the
        # very first scheduler-only path can also land here.)
        if not sub.title:
            try:
                root = ET.fromstring(fetched.body)
                t_elem = root.find("atom:title", _NS)
                if t_elem is not None and t_elem.text:
                    sub.title = t_elem.text.strip()[:300]
            except ET.ParseError:
                pass

        # YouTube's Atom feed lists entries newest-first. Keep that
        # order so when the cap below trims the tail it drops the OLDEST
        # entries, not the freshest. (Inbox sort order is independent —
        # /videos?tab=latest re-orders by published_at desc.)

        existing_ids = {
            r
            for (r,) in db.execute(
                select(ChannelVideo.video_id).where(
                    ChannelVideo.subscription_id == sub.id
                )
            ).all()
        }

        new_rows: list[ChannelVideo] = []
        for entry in entries:
            if entry.video_id in existing_ids:
                continue
            if len(new_rows) >= MAX_NEW_PER_POLL:
                break
            row = ChannelVideo(
                subscription_id=sub.id,
                video_id=entry.video_id,
                title=entry.title[:500],
                thumbnail_url=entry.thumbnail_url,
                duration_seconds=None,
                published_at=entry.published_at,
                is_short=entry.is_short,
                read_at=None,
                saved_card_id=None,
                discovered_at=datetime.now(tz=timezone.utc),
            )
            db.add(row)
            new_rows.append(row)

        sub.last_error = None
        sub.last_success_at = datetime.now(tz=timezone.utc)
        db.commit()

        summary["new_videos"] = len(new_rows)

        # Auto-ingest stage (only when the caller authorised it AND the
        # subscription is in auto mode). Run after the commit above so
        # the new rows exist for the dispatched jobs to point at.
        if allow_auto_ingest and sub.ingest_mode == "auto":
            pending: list[tuple[UUID, UUID, str]] = []
            queue_errors: list[str] = []
            for row in new_rows:
                if sub.exclude_shorts and row.is_short:
                    continue
                try:
                    card_id, job_id = _create_card_for_video(db, sub.user_id, row)
                except Exception as exc:  # noqa: BLE001
                    logger.exception(
                        "Auto-ingest row creation failed for video %s: %s",
                        row.video_id,
                        exc,
                    )
                    queue_errors.append(row.video_id)
                    continue
                if job_id is not None:
                    pending.append((card_id, job_id, row.video_id))
            sub.items_ingested = (sub.items_ingested or 0) + len(pending)
            if queue_errors:
                # Surface the per-row failure summary on the
                # subscription itself so the channel detail can flag it.
                sub.last_error = (
                    f"Auto-ingest queue failed for {len(queue_errors)} video(s): "
                    f"{', '.join(queue_errors[:3])}"
                )[:500]
            db.commit()
            # Spawn the single drainer thread AFTER commit — the thread
            # reads the rows we just inserted, so they must be visible.
            _drain_pending_in_background(pending)
            summary["queued_ingestion"] = len(pending)

        return summary
    finally:
        db.close()


def _parse_atom_entries(body: bytes) -> Iterable[PolledVideo]:
    """Parse a YouTube channel Atom feed body into PolledVideo rows.

    Skips entries without a `yt:videoId` (the feed includes a top-level
    <author> entry that we don't care about) and entries whose link path
    contains `/shorts/` so we can flag them up-front.
    """
    root = ET.fromstring(body)
    for entry in root.findall("atom:entry", _NS):
        vid_elem = entry.find("yt:videoId", _NS)
        if vid_elem is None or not (vid_elem.text or "").strip():
            continue
        video_id = vid_elem.text.strip()

        title_elem = entry.find("atom:title", _NS)
        title = (title_elem.text or "").strip() if title_elem is not None else video_id

        published_at: datetime | None = None
        pub_elem = entry.find("atom:published", _NS)
        if pub_elem is not None and pub_elem.text:
            try:
                published_at = datetime.fromisoformat(
                    pub_elem.text.replace("Z", "+00:00")
                )
            except ValueError:
                pass

        thumbnail_url: str | None = None
        thumb_elem = entry.find("media:group/media:thumbnail", _NS)
        if thumb_elem is not None:
            thumbnail_url = thumb_elem.attrib.get("url")

        # Heuristic: YouTube doesn't expose a "is short" flag in the RSS,
        # but uploaders whose links go through /shorts/<id> count. As of
        # 2025 the official Atom feed for non-shorts still uses the watch
        # URL. Channels that don't upload Shorts won't hit this branch.
        link_elem = entry.find("atom:link", _NS)
        link_href = link_elem.attrib.get("href", "") if link_elem is not None else ""
        is_short = "/shorts/" in link_href

        yield PolledVideo(
            video_id=video_id,
            title=title,
            thumbnail_url=thumbnail_url,
            published_at=published_at,
            is_short=is_short,
        )


# ── Sequential ingestion drainer ─────────────────────────────────────
#
# Same idea as `services/feeds.py::_drain_pending_in_background`:
# YouTube's transcript endpoint IP-blocks the caller within a second or
# two when 10+ video-id requests land in parallel. Per-channel auto-
# ingest and save-all-unread can easily fan out that wide, so both
# paths now share a single drainer thread that walks the queue with a
# polite delay between YouTube fetches.

# Seconds between transcript calls inside one drain. Matches the value
# proven safe in `services/feeds.py`.
_YT_DRAIN_DELAY_SECONDS = 4.0


def _create_card_for_video(
    db: Session,
    user_id: UUID,
    video_row: ChannelVideo,
) -> tuple[UUID, UUID | None]:
    """Insert Source / Card / Job rows for an inbox video, link it back
    to the inbox row, and return `(card_id, job_id)`.

    Idempotent — when the user already has a card for this video, the
    inbox row is linked to the existing card and `job_id` is None (no
    ingestion work to schedule).

    Does NOT spawn ingestion. The caller must call
    `_drain_pending_in_background` (or `_run_single_ingestion`) with the
    returned `(card_id, job_id, video_id)` once the surrounding
    transaction has been committed.
    """
    video_id = video_row.video_id
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    now = datetime.now(tz=timezone.utc)

    existing_card_id = db.execute(
        select(Card.id)
        .join(Source, Source.id == Card.source_id)
        .where(
            Card.user_id == user_id,
            Source.source_type == "youtube",
            Source.external_id == video_id,
        )
        .limit(1)
    ).scalar_one_or_none()

    if existing_card_id is not None:
        video_row.saved_card_id = existing_card_id
        video_row.read_at = now
        return existing_card_id, None

    source = Source(
        source_type="youtube",
        url=canonical,
        canonical_url=canonical,
        external_id=video_id,
    )
    db.add(source)
    db.flush()
    card = Card(
        user_id=user_id,
        source_id=source.id,
        title=video_row.title or f"YouTube {video_id}",
        thumbnail_url=video_row.thumbnail_url,
        source_type="youtube",
        status="queued",
    )
    db.add(card)
    db.flush()
    job = Job(card_id=card.id, job_type="youtube_ingest", status="queued")
    db.add(job)
    db.flush()

    video_row.saved_card_id = card.id
    # Flip read_at so the inbox count drops immediately. A later
    # ingestion failure surfaces as a `failed` card in the library
    # rather than re-opening the inbox row.
    video_row.read_at = now
    return card.id, job.id


def _drain_pending_in_background(
    pending: list[tuple[UUID, UUID, str]],
) -> None:
    """Walk pending `(card_id, job_id, video_id)` tuples in one daemon
    thread, sequentially. A `_YT_DRAIN_DELAY_SECONDS` pause is inserted
    between items so YouTube's transcript endpoint doesn't IP-block us.

    A no-op when `pending` is empty.
    """
    if not pending:
        return

    from app.services.ingestion import process_youtube_card

    def _run() -> None:
        import time

        for index, (card_id, job_id, video_id) in enumerate(pending):
            if index > 0:
                time.sleep(_YT_DRAIN_DELAY_SECONDS)
            try:
                process_youtube_card(card_id, job_id, video_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Channel-drain ingestion failed for %s: %s", card_id, exc
                )

    import threading

    threading.Thread(target=_run, daemon=True).start()


def _run_single_ingestion(card_id: UUID, job_id: UUID, video_id: str) -> None:
    """Single-video shortcut — no inter-item delay needed."""
    _drain_pending_in_background([(card_id, job_id, video_id)])


def poll_all_due_channels() -> int:
    """Scheduler entry — iterate all subscriptions, polling each in turn.

    Each row's failure is contained inside `poll_channel`; we still
    catch around the loop in case a bug raises out of the helper.
    """
    db = SessionLocal()
    try:
        sub_ids = db.execute(select(ChannelSubscription.id)).scalars().all()
    finally:
        db.close()

    polled = 0
    for sid in sub_ids:
        try:
            poll_channel(sid, allow_auto_ingest=True)
            polled += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Channel poll failed for %s: %s", sid, exc)
    return polled


def unread_count(db: Session, subscription_id: UUID) -> int:
    return int(
        db.execute(
            select(func.count(ChannelVideo.id)).where(
                ChannelVideo.subscription_id == subscription_id,
                ChannelVideo.read_at.is_(None),
            )
        ).scalar_one()
        or 0
    )


_SHORTS_PATH_RE = re.compile(r"/shorts/")


def is_short_url(url: str) -> bool:
    return bool(_SHORTS_PATH_RE.search(url or ""))
