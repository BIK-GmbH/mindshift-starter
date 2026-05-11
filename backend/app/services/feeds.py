"""RSS / Atom subscription polling.

A feed row is fetched, parsed via feedparser, and every entry whose URL
isn't already in the user's library is queued through the existing
article ingestion pipeline. We respect HTTP conditional GETs (etag /
last-modified) so unchanged feeds cost nothing on subsequent polls.

The scheduler at `services.feed_scheduler` invokes `poll_feed` on a
timer; the API also exposes a manual refresh button.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable
from uuid import UUID

import feedparser
import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.feed import Feed
from app.models.job import Job
from app.models.source import Source
from app.services.url_normalize import canonicalize_url

logger = logging.getLogger(__name__)

# Cap the number of brand-new entries we ingest from a single feed in one
# poll — protects against backfilled / republished feeds dumping hundreds
# of cards at once.
MAX_NEW_PER_POLL = 25
# A feed page is meant to be small. Refuse anything obviously not.
MAX_BYTES = 5 * 1024 * 1024

_USER_AGENT = (
    "Mozilla/5.0 (compatible; Mindshift-Feeds/0.1; +https://mindshift.local)"
)


def poll_feed(feed_id: UUID) -> dict:
    """Fetch the feed, queue new items as cards. Returns a small summary
    dict so the manual-refresh endpoint can show counts in the UI.

    Idempotent: re-running for an already-polled feed is a no-op as long
    as the etag is still valid.
    """
    # Lazy import to avoid the circular ingestion → feeds import path.
    from app.services.ingestion import process_article_card

    db = SessionLocal()
    summary = {"queued": 0, "skipped_seen": 0, "error": None}
    try:
        feed = db.get(Feed, feed_id)
        if feed is None:
            return summary
        if not feed.is_active:
            return summary

        feed.last_polled_at = datetime.now(tz=timezone.utc)

        try:
            parsed_data = _fetch(feed)
        except Exception as exc:  # noqa: BLE001 — fail-soft for one feed
            feed.last_error = str(exc)[:500]
            db.commit()
            summary["error"] = str(exc)
            return summary

        if parsed_data is None:
            # 304 Not Modified — nothing to do.
            feed.last_error = None
            feed.last_success_at = datetime.now(tz=timezone.utc)
            db.commit()
            return summary

        parsed, etag, last_modified = parsed_data

        # Update title from feed metadata on first poll, when empty, or
        # when the feed renamed itself.
        feed_title = getattr(parsed.feed, "title", "") or ""
        if not feed.title and feed_title:
            feed.title = feed_title.strip()[:300]
        site_link = getattr(parsed.feed, "link", None)
        if site_link and not feed.site_url:
            feed.site_url = str(site_link)[:2048]

        if etag:
            feed.last_etag = etag[:255]
        if last_modified:
            feed.last_modified = last_modified[:255]

        # Pick out genuinely new entries. Order: feedparser keeps the
        # feed's order (newest-first by convention) — we walk it and
        # stop after MAX_NEW_PER_POLL queued items, oldest-first so the
        # library shows them in chronological order.
        candidates = list(_normalise_entries(parsed.entries))
        candidates.reverse()  # oldest first

        # Canonicalise every candidate URL upfront. Without this an
        # article feed serving `?utm_source=rss` tracking params would
        # duplicate posts the user already saved via the extension /
        # share-target (different raw URL, same canonical). YouTube
        # already canonicalises inside `_create_card_from_feed_entry`,
        # but the article path was the weak spot.
        for entry in candidates:
            entry["canonical_url"] = canonicalize_url(entry["url"])

        existing_urls = _existing_card_urls(
            db,
            feed.user_id,
            [c["url"] for c in candidates] + [c["canonical_url"] for c in candidates],
        )
        queued = 0
        # Collect the ingestion jobs we kicked off so a SINGLE background
        # worker can drain them sequentially. Spawning one thread per
        # item caused YouTube to IP-block the transcript endpoint when a
        # fresh playlist feed dumped 15 videos at once.
        pending: list[tuple[UUID, str, str, str | None]] = []
        for entry in candidates:
            if queued >= MAX_NEW_PER_POLL:
                break
            url = entry["url"]
            canon = entry["canonical_url"]
            if url in existing_urls or canon in existing_urls:
                summary["skipped_seen"] += 1
                continue

            card_id, kind, external_id = _create_card_from_feed_entry(
                db, feed.user_id, url, entry["title"]
            )
            db.commit()  # commit so the BackgroundTask can read the row
            pending.append((card_id, url, kind, external_id))
            queued += 1
            summary["queued"] += 1

        feed.last_error = None
        feed.last_success_at = datetime.now(tz=timezone.utc)
        feed.items_ingested += queued
        db.commit()

        # Kick off the sequential drainer (one thread per poll, not one
        # per item). The drainer walks `pending` in order with a small
        # pause between YouTube items — generous enough that YouTube's
        # transcript endpoint doesn't IP-block us on a fresh feed.
        if pending:
            _drain_pending_in_background(pending)
        return summary
    finally:
        db.close()


def _fetch(feed: Feed):
    """Return (parsed, etag, last_modified) or None on 304."""
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8"}
    if feed.last_etag:
        headers["If-None-Match"] = feed.last_etag
    if feed.last_modified:
        headers["If-Modified-Since"] = feed.last_modified

    with httpx.Client(timeout=20.0, follow_redirects=True, headers=headers) as client:
        response = client.get(feed.feed_url)
        if response.status_code == 304:
            return None
        response.raise_for_status()
        if int(response.headers.get("content-length") or 0) > MAX_BYTES:
            raise ValueError("Feed exceeds size limit")
        body = response.content
        if len(body) > MAX_BYTES:
            raise ValueError("Feed exceeds size limit")
        etag = response.headers.get("etag")
        last_modified = response.headers.get("last-modified")

    parsed = feedparser.parse(body)
    if parsed.bozo and not parsed.entries:
        # bozo=1 with a flag we can't recover from + zero entries → fail.
        raise ValueError(f"Feed parse error: {parsed.bozo_exception}")
    return parsed, etag, last_modified


def _normalise_entries(entries: Iterable) -> Iterable[dict]:
    """Strip feedparser entries down to (title, url) — skip entries
    without a usable link."""
    for e in entries:
        url = getattr(e, "link", None) or getattr(e, "id", None)
        if not url or not isinstance(url, str):
            continue
        if not url.startswith(("http://", "https://")):
            continue
        title = (getattr(e, "title", "") or url).strip()
        yield {"url": url, "title": title[:300]}


def _existing_card_urls(db: Session, user_id: UUID, urls: list[str]) -> set[str]:
    """Return the subset of urls that already correspond to a card the
    user owns. Match on Source.url or Source.canonical_url."""
    if not urls:
        return set()
    rows = db.execute(
        select(Source.url, Source.canonical_url)
        .join(Card, Card.source_id == Source.id)
        .where(
            Card.user_id == user_id,
            (Source.url.in_(urls)) | (Source.canonical_url.in_(urls)),
        )
    ).all()
    seen: set[str] = set()
    for u, c in rows:
        if u:
            seen.add(u)
        if c:
            seen.add(c)
    return seen


def normalize_feed_url(raw: str) -> str:
    """Accept user-pasted URLs and return the canonical Atom/RSS URL.

    YouTube exposes Atom feeds at
        /feeds/videos.xml?playlist_id=<PL...>
        /feeds/videos.xml?channel_id=<UC...>
    but users naturally paste the browser-visible URLs:
        /playlist?list=PL...&si=...
        /channel/UC...
        /@handle
        /watch?v=...&list=PL...
    Rewriting transparently here means the feeds page just works
    without making the user copy-paste an obscure Atom URL.

    For non-YouTube URLs the input is returned untouched — RSS-on-
    article-sites, Substack, GitHub release feeds etc. all follow
    feed-url conventions the user can paste as-is.
    """
    from urllib.parse import parse_qs, urlparse

    s = (raw or "").strip()
    if not s:
        return s
    try:
        u = urlparse(s)
    except Exception:  # noqa: BLE001
        return s

    host = (u.hostname or "").lower()
    if host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        return s

    # Already an Atom feed URL — leave alone.
    if u.path.startswith("/feeds/"):
        return s

    qs = parse_qs(u.query)
    list_id = (qs.get("list") or [None])[0]
    if list_id:
        return f"https://www.youtube.com/feeds/videos.xml?playlist_id={list_id}"

    # /channel/UC...
    parts = [p for p in u.path.split("/") if p]
    if len(parts) >= 2 and parts[0] == "channel":
        return f"https://www.youtube.com/feeds/videos.xml?channel_id={parts[1]}"

    # /@handle — YouTube doesn't expose the channel-id directly via
    # @handle URLs; we'd need to scrape the channel page to find the
    # UC... id. Defer that complexity — return the raw URL and let
    # the feedparser fail with a clear message the user can react to.
    # (A future enhancement could resolve handle→channel_id via the
    # YouTube Data API or by fetching the HTML's `<meta itemprop`.)
    return s


def _classify_url(url: str) -> tuple[str, str | None]:
    """Decide which ingestion pipeline a feed entry belongs to.

    Mirrors the auto-routing in `/api/cards/from-url`:
      - YouTube watch / shorts / youtu.be links → ("youtube", video_id)
      - github.com/owner/repo                   → ("github", "owner/repo")
      - everything else                         → ("article", None)

    Returns a (kind, external_id) tuple so the caller can build the
    right Source row + queue the right background task.
    """
    from app.services.github import parse_repo_url as parse_github_url
    from app.services.youtube import extract_video_id

    video_id = extract_video_id(url)
    if video_id:
        return ("youtube", video_id)
    gh = parse_github_url(url)
    if gh:
        return ("github", f"{gh[0]}/{gh[1]}")
    return ("article", None)


def _create_card_from_feed_entry(
    db: Session, user_id: UUID, url: str, title: str
) -> tuple[UUID, str, str | None]:
    """Insert source + card + queued job rows for a feed entry.

    Returns (card_id, kind, external_id) so the caller knows which
    pipeline to dispatch. Mirrors `cards.create_card_from_url`'s
    auto-routing — without it, a YouTube playlist Atom feed would
    funnel every video through the article scraper and produce
    garbage (the watch-page HTML, not the transcript).
    """
    kind, external_id = _classify_url(url)

    if kind == "youtube":
        canonical = f"https://www.youtube.com/watch?v={external_id}"
        source = Source(
            source_type="youtube",
            url=url,
            canonical_url=canonical,
            external_id=external_id,
        )
    elif kind == "github":
        canonical = f"https://github.com/{external_id}"
        source = Source(
            source_type="github",
            url=url,
            canonical_url=canonical,
            external_id=external_id,
        )
    else:
        source = Source(source_type="article", url=url, canonical_url=url)

    db.add(source)
    db.flush()
    card = Card(
        user_id=user_id,
        source_id=source.id,
        title=title or url,
        source_type=kind,
        status="queued",
    )
    db.add(card)
    db.flush()
    job = Job(card_id=card.id, job_type=f"{kind}_ingest", status="queued")
    db.add(job)
    return card.id, kind, external_id


# Backwards-compat alias for any caller that still imports the old name.
def _create_article_card(db: Session, user_id: UUID, url: str, title: str) -> UUID:
    card_id, _, _ = _create_card_from_feed_entry(db, user_id, url, title)
    return card_id


# Pause between YouTube transcript fetches inside a feed drain. The
# transcript endpoint IP-blocks fast (under a second per request from a
# single source) when 15 videos arrive at once; 4 s of jitter is enough
# to look like an ordinary user adding videos one after another.
_YT_DRAIN_DELAY_SECONDS = 4.0


def _drain_pending_in_background(
    pending: list[tuple[UUID, str, str, str | None]],
) -> None:
    """Walk `pending` items in one background thread, sequentially.

    Each tuple is (card_id, url, kind, external_id). The function looks
    up the matching Job row and dispatches to the right pipeline. A small
    delay between YouTube items keeps YouTube from IP-blocking us when a
    fresh playlist feed delivers many videos at once.
    """
    import threading
    import time

    from app.services.ingestion import (
        process_article_card,
        process_github_card,
        process_youtube_card,
    )

    def _run() -> None:
        for index, (card_id, url, kind, external_id) in enumerate(pending):
            db = SessionLocal()
            try:
                job_id = db.execute(
                    select(Job.id)
                    .where(Job.card_id == card_id, Job.status == "queued")
                    .order_by(Job.created_at.desc())
                    .limit(1)
                ).scalar_one_or_none()
            finally:
                db.close()
            if job_id is None:
                continue

            try:
                if kind == "youtube" and external_id:
                    if index > 0:
                        time.sleep(_YT_DRAIN_DELAY_SECONDS)
                    process_youtube_card(card_id, job_id, external_id)
                elif kind == "github":
                    process_github_card(card_id, job_id, url)
                else:
                    process_article_card(card_id, job_id, url)
            except Exception as exc:  # noqa: BLE001 — never let one bad item break the drain
                logger.exception("Feed-drain ingestion failed for %s: %s", card_id, exc)

    threading.Thread(target=_run, daemon=True).start()


def _schedule_ingest(card_id: UUID, url: str, kind: str = "article", external_id: str | None = None) -> None:
    """Backwards-compat single-item scheduler. Used only by the legacy
    `_create_article_card` alias; new code path goes through
    `_drain_pending_in_background` which serialises ingestion."""
    _drain_pending_in_background([(card_id, url, kind, external_id)])


def poll_all_due_feeds() -> int:
    """Triggered by the scheduler. Polls every active feed in turn.

    Polls are spaced sequentially to keep memory bounded and to avoid
    hammering small self-hosted publishers from a single IP.
    """
    db = SessionLocal()
    try:
        feed_ids = db.execute(select(Feed.id).where(Feed.is_active.is_(True))).scalars().all()
    finally:
        db.close()
    polled = 0
    for fid in feed_ids:
        try:
            poll_feed(fid)
            polled += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Feed poll failed for %s: %s", fid, exc)
    return polled


def feed_count_for_user(db: Session, user_id: UUID) -> int:
    return int(
        db.execute(select(func.count(Feed.id)).where(Feed.user_id == user_id)).scalar_one() or 0
    )
