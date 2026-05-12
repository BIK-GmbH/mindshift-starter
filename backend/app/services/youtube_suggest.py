"""YouTube Data API v3 wrapper for "Suggest more videos" surfaces.

Two callers:

  * `suggest_for_card(card_id)` — used by the Related-tab YouTube
    sub-toggle. The query is built from the card's tags + top entities
    (cheap, deterministic, no LLM cost). Results are cached for 24 h
    per (user_id, 'card', card_id).

  * `discover_for_user(user_id)` — used by the Discover page. The
    user's library is clustered into 4–7 themes (top-level tags +
    optional LLM polish in a future iteration); each theme runs one
    search and we return the bundle. Cached per (user_id,
    'discover_theme', <theme-slug>).

Both paths funnel into `_search_youtube`, the lone HTTP entry point.
Without `YOUTUBE_API_KEY` configured, every call returns an empty list
with a soft `disabled=True` sentinel — surfaces render a friendly
"Add YOUTUBE_API_KEY to enable" empty state instead of an error.

We dedupe by YouTube `videoId` (= `Source.external_id` for the user's
existing youtube cards) and **don't drop** matches — instead each
result carries `already_saved_card_id` so the UI can switch CTA from
"Save" to "Open card".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.card import Card
from app.models.entity import CardEntity, Entity
from app.models.source import Source
from app.models.tag import CardTag, Tag
from app.models.youtube_suggestion import YouTubeSuggestionCache

logger = logging.getLogger(__name__)

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
CACHE_TTL = timedelta(hours=24)
MAX_RESULTS_PER_QUERY = 8
DISCOVER_MAX_THEMES = 6


@dataclass
class SuggestionItem:
    video_id: str
    title: str
    channel: str
    description: str
    thumbnail_url: str
    published_at: str
    duration_iso: str | None
    already_saved_card_id: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "video_id": self.video_id,
            "title": self.title,
            "channel": self.channel,
            "description": self.description,
            "thumbnail_url": self.thumbnail_url,
            "published_at": self.published_at,
            "duration_iso": self.duration_iso,
            "already_saved_card_id": self.already_saved_card_id,
        }


# --------------------------------------------------------------------------
# Cache helpers


def _fresh_cache_row(
    db: Session, user_id: UUID, scope: str, scope_key: str
) -> YouTubeSuggestionCache | None:
    row = db.execute(
        select(YouTubeSuggestionCache).where(
            YouTubeSuggestionCache.user_id == user_id,
            YouTubeSuggestionCache.scope == scope,
            YouTubeSuggestionCache.scope_key == scope_key,
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    cutoff = datetime.now(timezone.utc) - CACHE_TTL
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if created < cutoff:
        return None
    return row


def _write_cache(
    db: Session,
    user_id: UUID,
    scope: str,
    scope_key: str,
    query: str,
    results: list[dict[str, Any]],
) -> None:
    existing = db.execute(
        select(YouTubeSuggestionCache).where(
            YouTubeSuggestionCache.user_id == user_id,
            YouTubeSuggestionCache.scope == scope,
            YouTubeSuggestionCache.scope_key == scope_key,
        )
    ).scalar_one_or_none()
    if existing is None:
        row = YouTubeSuggestionCache(
            user_id=user_id,
            scope=scope,
            scope_key=scope_key,
            query=query,
            results_json=results,
        )
        db.add(row)
    else:
        existing.query = query
        existing.results_json = results
        existing.created_at = datetime.now(timezone.utc)
    db.commit()


# --------------------------------------------------------------------------
# Query building


def derive_card_query(db: Session, card: Card) -> str:
    """Build a search string from the card's tags + top entities.

    Tags are the strongest signal (user-curated) and come first. We
    skip the card's own title — it's noisy (often has channel-prefix
    junk like "I built a…") and would bias results back to the same
    creator.
    """
    tag_names = (
        db.execute(
            select(Tag.name)
            .join(CardTag, CardTag.tag_id == Tag.id)
            .where(CardTag.card_id == card.id)
            .order_by(Tag.name)
        )
        .scalars()
        .all()
    )
    entity_names = (
        db.execute(
            select(Entity.name)
            .join(CardEntity, CardEntity.entity_id == Entity.id)
            .where(CardEntity.card_id == card.id)
            .order_by(CardEntity.relevance_score.desc().nullslast())
            .limit(3)
        )
        .scalars()
        .all()
    )

    # Keep the bare leaf if a tag is "parent/child" (search-friendlier).
    cleaned_tags = [n.split("/")[-1] for n in tag_names if n]
    parts = [*cleaned_tags[:3], *entity_names]
    # de-dupe, preserve order, drop empties
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        norm = p.strip()
        if not norm:
            continue
        key = norm.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(norm)
    if not out:
        # Fall back to the card title as a last resort — rare path.
        return card.title.strip()
    return " ".join(out)


def discover_themes(db: Session, user_id: UUID) -> list[tuple[str, str, str, int]]:
    """Return up to `DISCOVER_MAX_THEMES` (slug, label, query, card_count) tuples.

    Strategy: pick the user's top-level tags (those without a parent),
    ranked by how many of their cards (including descendants) use them.
    The slug is a stable scope_key for the cache.
    """
    top_tags = (
        db.execute(
            select(Tag.id, Tag.name)
            .where(Tag.user_id == user_id, Tag.parent_id.is_(None))
            .order_by(Tag.name)
        )
        .all()
    )
    themes: list[tuple[str, str, str, int]] = []
    for tag_id, tag_name in top_tags:
        # All descendant ids — one level is enough for the common case.
        descendant_ids = (
            db.execute(
                select(Tag.id).where(
                    (Tag.user_id == user_id)
                    & ((Tag.id == tag_id) | (Tag.parent_id == tag_id))
                )
            )
            .scalars()
            .all()
        )
        if not descendant_ids:
            continue
        count = (
            db.execute(
                select(CardTag.card_id)
                .join(Card, Card.id == CardTag.card_id)
                .where(Card.user_id == user_id, CardTag.tag_id.in_(descendant_ids))
                .distinct()
            )
            .all()
        )
        if not count:
            continue
        # Query: just the leaf-name reads best on YouTube.
        slug = tag_name.lower().replace(" ", "-").replace("/", "-")
        themes.append((slug, tag_name, tag_name, len(count)))

    themes.sort(key=lambda t: t[3], reverse=True)
    return themes[:DISCOVER_MAX_THEMES]


# --------------------------------------------------------------------------
# HTTP


def _dedupe_against_library(
    db: Session, user_id: UUID, video_ids: list[str]
) -> dict[str, str]:
    """For each video_id, return the user's card_id if they already saved it."""
    if not video_ids:
        return {}
    rows = db.execute(
        select(Card.id, Source.external_id)
        .join(Source, Source.id == Card.source_id)
        .where(
            Card.user_id == user_id,
            Source.source_type == "youtube",
            Source.external_id.in_(video_ids),
        )
    ).all()
    return {ext_id: str(cid) for cid, ext_id in rows if ext_id}


def _parse_search_items(
    items: list[dict[str, Any]],
    duration_by_id: dict[str, str],
    saved_by_id: dict[str, str],
) -> list[SuggestionItem]:
    out: list[SuggestionItem] = []
    for it in items:
        vid = (it.get("id") or {}).get("videoId")
        snip = it.get("snippet") or {}
        if not vid or not snip:
            continue
        thumbs = snip.get("thumbnails") or {}
        thumb = (
            (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get(
                "url", ""
            )
        )
        out.append(
            SuggestionItem(
                video_id=vid,
                title=snip.get("title", ""),
                channel=snip.get("channelTitle", ""),
                description=snip.get("description", ""),
                thumbnail_url=thumb,
                published_at=snip.get("publishedAt", ""),
                duration_iso=duration_by_id.get(vid),
                already_saved_card_id=saved_by_id.get(vid),
            )
        )
    return out


def _search_youtube(query: str, max_results: int = MAX_RESULTS_PER_QUERY) -> list[dict[str, Any]]:
    """One round-trip — `search.list` + `videos.list` for durations.

    Returns the raw item dicts so the caller can decide on dedup logic.
    """
    settings = get_settings()
    key = settings.youtube_api_key.strip()
    if not key:
        return []

    params = {
        "key": key,
        "q": query,
        "part": "snippet",
        "type": "video",
        "maxResults": str(max_results),
        "safeSearch": "moderate",
        "videoEmbeddable": "true",
        "relevanceLanguage": "en",
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/search", params=params)
            r.raise_for_status()
            items = (r.json().get("items") or [])
            video_ids = [
                ((it.get("id") or {}).get("videoId"))
                for it in items
                if (it.get("id") or {}).get("videoId")
            ]
            duration_by_id: dict[str, str] = {}
            if video_ids:
                rd = client.get(
                    f"{YOUTUBE_API_BASE}/videos",
                    params={
                        "key": key,
                        "id": ",".join(video_ids),
                        "part": "contentDetails",
                    },
                )
                rd.raise_for_status()
                for v in rd.json().get("items") or []:
                    dur = ((v.get("contentDetails") or {}).get("duration"))
                    if v.get("id") and dur:
                        duration_by_id[v["id"]] = dur
            # Attach durations onto items for the caller.
            for it in items:
                vid = (it.get("id") or {}).get("videoId")
                if vid and vid in duration_by_id:
                    it["_duration_iso"] = duration_by_id[vid]
            return items
    except httpx.HTTPError as exc:
        logger.warning("YouTube API request failed for %r: %s", query, exc)
        return []


# --------------------------------------------------------------------------
# Public service entry points


def suggest_for_card(
    db: Session, user_id: UUID, card: Card, *, force_refresh: bool = False
) -> tuple[str, list[dict[str, Any]], bool]:
    """Return (query, results, from_cache). Cached for 24 h.

    Raises nothing — returns ('', [], False) when the API key is unset.
    """
    settings = get_settings()
    if not settings.youtube_api_key.strip():
        return ("", [], False)

    if not force_refresh:
        cached = _fresh_cache_row(db, user_id, "card", str(card.id))
        if cached is not None:
            return (cached.query, list(cached.results_json), True)

    query = derive_card_query(db, card)
    if not query:
        return ("", [], False)

    items = _search_youtube(query)
    video_ids = [
        ((it.get("id") or {}).get("videoId"))
        for it in items
        if (it.get("id") or {}).get("videoId")
    ]
    saved_map = _dedupe_against_library(db, user_id, video_ids)
    duration_map = {
        ((it.get("id") or {}).get("videoId")): it.get("_duration_iso")
        for it in items
        if it.get("_duration_iso")
    }
    parsed = [s.as_dict() for s in _parse_search_items(items, duration_map, saved_map)]
    _write_cache(db, user_id, "card", str(card.id), query, parsed)
    return (query, parsed, False)


def discover_for_user(
    db: Session, user_id: UUID, *, force_refresh: bool = False
) -> list[dict[str, Any]]:
    """Return a list of theme bundles for the Discover page.

    Each bundle: {slug, label, query, card_count, results, from_cache}.
    """
    settings = get_settings()
    if not settings.youtube_api_key.strip():
        return []

    themes = discover_themes(db, user_id)
    out: list[dict[str, Any]] = []
    for slug, label, query, count in themes:
        from_cache = False
        if not force_refresh:
            cached = _fresh_cache_row(db, user_id, "discover_theme", slug)
            if cached is not None:
                out.append(
                    {
                        "slug": slug,
                        "label": label,
                        "query": cached.query,
                        "card_count": count,
                        "results": list(cached.results_json),
                        "from_cache": True,
                    }
                )
                continue

        items = _search_youtube(query, max_results=MAX_RESULTS_PER_QUERY)
        video_ids = [
            ((it.get("id") or {}).get("videoId"))
            for it in items
            if (it.get("id") or {}).get("videoId")
        ]
        saved_map = _dedupe_against_library(db, user_id, video_ids)
        duration_map = {
            ((it.get("id") or {}).get("videoId")): it.get("_duration_iso")
            for it in items
            if it.get("_duration_iso")
        }
        parsed = [s.as_dict() for s in _parse_search_items(items, duration_map, saved_map)]
        _write_cache(db, user_id, "discover_theme", slug, query, parsed)
        out.append(
            {
                "slug": slug,
                "label": label,
                "query": query,
                "card_count": count,
                "results": parsed,
                "from_cache": from_cache,
            }
        )
    return out
