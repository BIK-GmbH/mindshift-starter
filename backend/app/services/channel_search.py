"""YouTube channel discovery — search, URL/handle resolve, library suggestions.

Three callers:
  * `/api/channels/search` — `search.list&type=channel` (100 units / call).
  * `/api/channels/resolve` — accepts a user-pasted URL or `@handle`; uses
    `channels.list` (1 unit) where possible, falls back to one search call
    for bare handles that the channels endpoint can't look up directly.
  * `/api/channels/suggestions` — purely from the user's existing YouTube
    cards. Zero API cost.

If `YOUTUBE_API_KEY` is unset, the API calls return empty lists rather
than raising — the UI shows a friendly "set the env var" hint.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.card import Card
from app.models.channel_subscription import ChannelSubscription
from app.models.source import Source

logger = logging.getLogger(__name__)

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
MAX_SEARCH_RESULTS = 10
SUGGEST_MIN_CARDS = 2
SUGGEST_LIMIT = 10


@dataclass
class ChannelResult:
    channel_id: str
    title: str
    handle: str | None
    thumbnail_url: str | None
    subscriber_count: int | None
    description: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "channel_id": self.channel_id,
            "title": self.title,
            "handle": self.handle,
            "thumbnail_url": self.thumbnail_url,
            "subscriber_count": self.subscriber_count,
            "description": self.description,
        }


# ---------------------------------------------------------------------------
# YouTube Data API wrappers


def _api_key() -> str | None:
    key = get_settings().youtube_api_key.strip()
    return key or None


def _parse_channel_item(item: dict[str, Any]) -> ChannelResult | None:
    """Normalise either a `channels.list` row or a `search.list&type=channel`
    row into the same shape."""
    snippet = item.get("snippet") or {}
    # `channels.list` puts id at the top level, `search.list` nests it.
    ch_id = item.get("id")
    if isinstance(ch_id, dict):
        ch_id = ch_id.get("channelId")
    if not ch_id:
        return None
    thumbs = snippet.get("thumbnails") or {}
    thumb = (
        thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}
    ).get("url")
    stats = item.get("statistics") or {}
    sub_count_raw = stats.get("subscriberCount")
    try:
        sub_count = int(sub_count_raw) if sub_count_raw is not None else None
    except (TypeError, ValueError):
        sub_count = None
    handle = (snippet.get("customUrl") or "").strip() or None
    if handle and not handle.startswith("@"):
        handle = "@" + handle
    return ChannelResult(
        channel_id=ch_id,
        title=(snippet.get("title") or "").strip(),
        handle=handle,
        thumbnail_url=thumb,
        subscriber_count=sub_count,
        description=(snippet.get("description") or "").strip() or None,
    )


def search_channels(query: str, *, max_results: int = MAX_SEARCH_RESULTS) -> list[ChannelResult]:
    """`search.list&type=channel`. Costs 100 units. Empty list when unconfigured."""
    key = _api_key()
    q = (query or "").strip()
    if not key or not q:
        return []
    params = {
        "key": key,
        "q": q,
        "part": "snippet",
        "type": "channel",
        "maxResults": str(max_results),
        "safeSearch": "moderate",
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/search", params=params)
            r.raise_for_status()
            items = (r.json().get("items") or [])
            # Hydrate stats + handle via channels.list — one batched call.
            ids = []
            for it in items:
                cid = (it.get("id") or {}).get("channelId")
                if cid:
                    ids.append(cid)
            hydrated = _fetch_channels_by_id(ids) if ids else {}
            out: list[ChannelResult] = []
            for it in items:
                cid = (it.get("id") or {}).get("channelId")
                if cid and cid in hydrated:
                    out.append(hydrated[cid])
                    continue
                parsed = _parse_channel_item(it)
                if parsed is not None:
                    out.append(parsed)
            return out
    except httpx.HTTPError as exc:
        logger.warning("YouTube channel search failed for %r: %s", q, exc)
        return []


def _fetch_channels_by_id(channel_ids: list[str]) -> dict[str, ChannelResult]:
    key = _api_key()
    if not key or not channel_ids:
        return {}
    params = {
        "key": key,
        "id": ",".join(channel_ids[:50]),
        "part": "snippet,statistics",
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/channels", params=params)
            r.raise_for_status()
            items = r.json().get("items") or []
            out: dict[str, ChannelResult] = {}
            for it in items:
                parsed = _parse_channel_item(it)
                if parsed is not None:
                    out[parsed.channel_id] = parsed
            return out
    except httpx.HTTPError as exc:
        logger.warning("YouTube channels.list failed for ids=%s: %s", channel_ids, exc)
        return {}


def _fetch_channel_by_handle(handle: str) -> ChannelResult | None:
    """YouTube Data API v3 supports `forHandle=@x` since 2023."""
    key = _api_key()
    h = handle.strip()
    if not h:
        return None
    if not h.startswith("@"):
        h = "@" + h
    if key:
        params = {"key": key, "forHandle": h, "part": "snippet,statistics"}
        try:
            with httpx.Client(timeout=15.0) as client:
                r = client.get(f"{YOUTUBE_API_BASE}/channels", params=params)
                r.raise_for_status()
                items = r.json().get("items") or []
                if items:
                    return _parse_channel_item(items[0])
        except httpx.HTTPError as exc:
            logger.warning("forHandle lookup failed for %s: %s", h, exc)
    # Fallback: one search.list call (100 units).
    results = search_channels(h.lstrip("@"), max_results=1)
    return results[0] if results else None


# ---------------------------------------------------------------------------
# URL/handle resolution


_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_-]{20,24}$")
_HANDLE_RE = re.compile(r"^@[A-Za-z0-9._-]{2,40}$")


def resolve_channel(url_or_handle: str) -> ChannelResult | None:
    """Accept any of:
      - `UCxxx…` raw channel id
      - `@handle` or plain `handle`
      - `https://youtube.com/channel/UCxxx`
      - `https://youtube.com/@handle`
      - `https://youtube.com/c/CustomName` / `/user/Username` (legacy)
      - `https://youtube.com/watch?v=...` → resolves the video's channel
    """
    raw = (url_or_handle or "").strip()
    if not raw:
        return None

    if _CHANNEL_ID_RE.match(raw):
        result = _fetch_channels_by_id([raw])
        return result.get(raw)

    if _HANDLE_RE.match(raw) or _HANDLE_RE.match("@" + raw):
        return _fetch_channel_by_handle(raw)

    if "://" in raw or raw.startswith("youtube.com") or raw.startswith("www.youtube.com"):
        if not raw.startswith("http"):
            raw = "https://" + raw
        try:
            u = urlparse(raw)
        except Exception:
            return None
        host = (u.hostname or "").lower()
        if "youtube.com" not in host and "youtu.be" not in host:
            return None

        path_parts = [p for p in u.path.split("/") if p]

        if len(path_parts) >= 2 and path_parts[0] == "channel":
            cid = path_parts[1]
            if _CHANNEL_ID_RE.match(cid):
                return _fetch_channels_by_id([cid]).get(cid)

        if path_parts and path_parts[0].startswith("@"):
            return _fetch_channel_by_handle(path_parts[0])

        if len(path_parts) >= 2 and path_parts[0] in {"c", "user"}:
            return _fetch_channel_by_handle(path_parts[1])

        if u.path in {"/watch", "/shorts"}:
            video_id = None
            if u.path == "/watch":
                video_id = (parse_qs(u.query).get("v") or [None])[0]
            else:  # /shorts/<id>
                video_id = path_parts[1] if len(path_parts) >= 2 else None
            if video_id:
                return _fetch_channel_by_video(video_id)

        # /@handle without trailing slash hits len(parts)==0 above sometimes;
        # already handled via the @ prefix branch.
        return None

    # Bare token that wasn't @-prefixed or a UC id — try as handle.
    return _fetch_channel_by_handle(raw)


def _fetch_channel_by_video(video_id: str) -> ChannelResult | None:
    key = _api_key()
    if not key:
        return None
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                f"{YOUTUBE_API_BASE}/videos",
                params={"key": key, "id": video_id, "part": "snippet"},
            )
            r.raise_for_status()
            items = r.json().get("items") or []
            if not items:
                return None
            ch_id = (items[0].get("snippet") or {}).get("channelId")
            if not ch_id:
                return None
            return _fetch_channels_by_id([ch_id]).get(ch_id)
    except httpx.HTTPError as exc:
        logger.warning("videos.list failed for %s: %s", video_id, exc)
        return None


# ---------------------------------------------------------------------------
# Library-derived suggestions


def library_suggestions(db: Session, user_id: UUID) -> list[dict[str, Any]]:
    """Look at the user's existing YouTube cards, group by channel, return
    the top channels they haven't subscribed to yet.

    We pull `channel` out of `sources.metadata_json` (set during ingestion
    by `process_youtube_card`). Channels without a channel-id stored are
    skipped — we'd need a YouTube API hop to recover it, not worth the
    cost on a suggestion list.
    """
    # Existing subs to filter against.
    existing = {
        s
        for (s,) in db.execute(
            select(ChannelSubscription.channel_id).where(
                ChannelSubscription.user_id == user_id
            )
        ).all()
    }

    # `metadata_json -> 'channel'` is set by services.youtube.fetch_metadata
    # but the value is the channel *title* not the id. We also stash the
    # channel id under `channel_id` when available. We surface both: the
    # title is what the user reads, the id is what we resolve to.
    rows = db.execute(
        select(
            Source.metadata_json,
        )
        .join(Card, Card.source_id == Source.id)
        .where(
            Card.user_id == user_id,
            Source.source_type == "youtube",
        )
    ).all()

    # Bucket by (channel_id or title) — title is the fallback.
    buckets: dict[str, dict[str, Any]] = {}
    for (meta,) in rows:
        if not isinstance(meta, dict):
            continue
        channel_id = (meta.get("channel_id") or "").strip()
        title = (meta.get("channel") or "").strip()
        if not channel_id and not title:
            continue
        key = channel_id or f"title:{title.lower()}"
        if key not in buckets:
            buckets[key] = {
                "channel_id": channel_id,
                "title": title,
                "card_count": 0,
            }
        buckets[key]["card_count"] += 1

    candidates = sorted(
        (b for b in buckets.values() if b["card_count"] >= SUGGEST_MIN_CARDS),
        key=lambda b: (-b["card_count"], (b.get("title") or "").lower()),
    )

    # Resolve channel_id-less candidates lazily? Skip them — we don't want
    # to burn API units on suggestions. Only return channels we already
    # have an id for; the ones without an id get filed under
    # `pending_resolution` in the response for future hydration.
    out: list[dict[str, Any]] = []
    for c in candidates:
        if not c["channel_id"]:
            continue
        if c["channel_id"] in existing:
            continue
        out.append(
            {
                "channel_id": c["channel_id"],
                "title": c["title"] or c["channel_id"],
                "handle": None,
                "thumbnail_url": None,
                "subscriber_count": None,
                "description": None,
                "card_count_in_library": c["card_count"],
            }
        )
        if len(out) >= SUGGEST_LIMIT:
            break
    return out


# ---------------------------------------------------------------------------
# Popular tab


def popular_videos(channel_id: str, *, max_results: int = 10) -> list[dict[str, Any]]:
    """`search.list?channelId=…&order=viewCount&type=video`. Costs 100 units.

    Returns a list of dicts shaped like ChannelVideoOut so the API layer
    can hand them straight to Pydantic.
    """
    key = _api_key()
    if not key:
        return []
    params = {
        "key": key,
        "channelId": channel_id,
        "order": "viewCount",
        "type": "video",
        "part": "snippet",
        "maxResults": str(max_results),
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/search", params=params)
            r.raise_for_status()
            items = r.json().get("items") or []
            video_ids = [
                ((it.get("id") or {}).get("videoId")) for it in items if (it.get("id") or {}).get("videoId")
            ]
            stats = _fetch_video_stats(video_ids) if video_ids else {}
            out: list[dict[str, Any]] = []
            for it in items:
                vid = (it.get("id") or {}).get("videoId")
                if not vid:
                    continue
                snip = it.get("snippet") or {}
                thumbs = snip.get("thumbnails") or {}
                thumb = (
                    thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}
                ).get("url")
                meta = stats.get(vid) or {}
                out.append(
                    {
                        "video_id": vid,
                        "title": (snip.get("title") or "").strip(),
                        "thumbnail_url": thumb,
                        "duration_seconds": meta.get("duration_seconds"),
                        "published_at": snip.get("publishedAt"),
                        "is_short": bool(meta.get("is_short")),
                        "view_count": meta.get("view_count"),
                        "read_at": None,
                        "saved_card_id": None,
                    }
                )
            return out
    except httpx.HTTPError as exc:
        logger.warning("YouTube popular fetch failed for %s: %s", channel_id, exc)
        return []


def _fetch_video_stats(video_ids: list[str]) -> dict[str, dict[str, Any]]:
    key = _api_key()
    if not key or not video_ids:
        return {}
    params = {
        "key": key,
        "id": ",".join(video_ids[:50]),
        "part": "contentDetails,statistics",
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/videos", params=params)
            r.raise_for_status()
            out: dict[str, dict[str, Any]] = {}
            for v in r.json().get("items") or []:
                vid = v.get("id")
                if not vid:
                    continue
                stats = v.get("statistics") or {}
                vc_raw = stats.get("viewCount")
                try:
                    vc = int(vc_raw) if vc_raw is not None else None
                except (TypeError, ValueError):
                    vc = None
                cd = v.get("contentDetails") or {}
                dur_iso = cd.get("duration")
                dur_seconds = _iso8601_duration_seconds(dur_iso) if dur_iso else None
                out[vid] = {
                    "duration_seconds": dur_seconds,
                    "view_count": vc,
                    "is_short": bool(dur_seconds is not None and dur_seconds < 60),
                }
            return out
    except httpx.HTTPError as exc:
        logger.warning("videos.list stats failed: %s", exc)
        return {}


_ISO_DUR_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")


def _iso8601_duration_seconds(iso: str) -> int | None:
    m = _ISO_DUR_RE.match(iso.strip())
    if not m:
        return None
    h, mn, s = m.groups()
    return int(h or 0) * 3600 + int(mn or 0) * 60 + int(s or 0)
