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

import json
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
# Per theme: how many distinct LLM-generated queries we run, and how
# many results we keep in the cache pool. The frontend pages through
# this pool with "Load more" — fresh API calls only happen on refresh.
DISCOVER_QUERIES_PER_THEME = 3
DISCOVER_POOL_SIZE = 24
DISCOVER_PER_QUERY = 10
# Hard filter — "medium" = 4–20 min, kills Shorts and 3 h conference
# talks that overwhelm the watch surface.
DISCOVER_VIDEO_DURATION = "medium"
DISCOVER_MAX_PER_CHANNEL = 2

# Freshness presets. Default is "month" (30 days) — AI tooling moves
# fast and anything older is usually superseded by a newer take. The
# user can override per-request via /api/youtube/discover?freshness=…
FRESHNESS_DAYS: dict[str, int | None] = {
    "week": 7,
    "month": 30,
    "quarter": 90,
    "year": 365,
    "all": None,
}
DEFAULT_FRESHNESS = "month"


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


@dataclass
class ThemeInfo:
    slug: str
    label: str
    descendant_tag_ids: list[UUID]
    card_count: int


def discover_themes(db: Session, user_id: UUID) -> list[ThemeInfo]:
    """Return up to `DISCOVER_MAX_THEMES` ThemeInfo entries.

    Strategy: pick the user's top-level tags (those without a parent),
    ranked by how many of their cards (including descendants) use
    them. `descendant_tag_ids` is used downstream to sample
    representative cards for the LLM query generator.
    """
    top_tags = (
        db.execute(
            select(Tag.id, Tag.name)
            .where(Tag.user_id == user_id, Tag.parent_id.is_(None))
            .order_by(Tag.name)
        )
        .all()
    )
    themes: list[ThemeInfo] = []
    for tag_id, tag_name in top_tags:
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
        slug = tag_name.lower().replace(" ", "-").replace("/", "-")
        themes.append(
            ThemeInfo(
                slug=slug,
                label=tag_name,
                descendant_tag_ids=list(descendant_ids),
                card_count=len(count),
            )
        )

    themes.sort(key=lambda t: t.card_count, reverse=True)
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


def _search_youtube(
    query: str,
    *,
    max_results: int = MAX_RESULTS_PER_QUERY,
    video_duration: str | None = None,
    published_after_days: int | None = None,
    relevance_language: str = "en",
    page_token: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """One round-trip — `search.list` + `videos.list` for durations.

    Returns `(items, next_page_token)`. Caller decides dedup logic.
    """
    settings = get_settings()
    key = settings.youtube_api_key.strip()
    if not key:
        return ([], None)

    params: dict[str, str] = {
        "key": key,
        "q": query,
        "part": "snippet",
        "type": "video",
        "maxResults": str(max_results),
        "safeSearch": "moderate",
        "videoEmbeddable": "true",
        "order": "relevance",
        "relevanceLanguage": relevance_language,
    }
    if video_duration:
        params["videoDuration"] = video_duration
    if published_after_days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=published_after_days)
        params["publishedAfter"] = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    if page_token:
        params["pageToken"] = page_token
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(f"{YOUTUBE_API_BASE}/search", params=params)
            r.raise_for_status()
            payload = r.json()
            items = (payload.get("items") or [])
            next_token = payload.get("nextPageToken")
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
            return (items, next_token)
    except httpx.HTTPError as exc:
        logger.warning("YouTube API request failed for %r: %s", query, exc)
        return ([], None)


# --------------------------------------------------------------------------
# Discover-v2 helpers — LLM-driven query generation + diversity


def _gather_theme_context(
    db: Session, user_id: UUID, descendant_tag_ids: list[UUID], *, sample_size: int = 8
) -> dict[str, list[str]]:
    """Collect titles / summaries / entities of the theme's representative cards.

    The newest cards are likely the most aligned with what the user is
    currently exploring; older cards risk biasing the query toward
    stale subtopics.
    """
    rows = db.execute(
        select(Card.id, Card.title, Card.concise_summary_md)
        .join(CardTag, CardTag.card_id == Card.id)
        .where(Card.user_id == user_id, CardTag.tag_id.in_(descendant_tag_ids))
        .order_by(Card.created_at.desc())
        .limit(sample_size)
    ).all()

    titles: list[str] = []
    summaries: list[str] = []
    card_ids: list[UUID] = []
    for cid, title, summary in rows:
        card_ids.append(cid)
        if title:
            titles.append(title.strip())
        if summary:
            summaries.append(summary.strip()[:300])

    entity_names: list[str] = []
    if card_ids:
        entity_rows = db.execute(
            select(Entity.name)
            .join(CardEntity, CardEntity.entity_id == Entity.id)
            .where(CardEntity.card_id.in_(card_ids))
            .order_by(CardEntity.relevance_score.desc().nullslast())
            .limit(15)
        ).scalars().all()
        # Dedup but keep ordering.
        seen: set[str] = set()
        for name in entity_rows:
            key = name.lower()
            if key not in seen:
                seen.add(key)
                entity_names.append(name)

    return {"titles": titles, "summaries": summaries, "entities": entity_names}


def _generate_discover_queries(theme_label: str, context: dict[str, list[str]]) -> list[str]:
    """Ask gpt-5.4-mini for 3 specific YouTube search queries for this theme.

    Falls back to `[theme_label]` if OpenAI is unconfigured or fails —
    the surface still works, just less sharply.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return [theme_label]

    titles = "\n".join(f"- {t}" for t in context["titles"][:8])
    summaries = "\n".join(f"- {s}" for s in context["summaries"][:5])
    entities = ", ".join(context["entities"][:10]) or "(none)"

    system = (
        "You generate YouTube search queries that surface fresh, specific "
        "videos for a user who already saved several cards on a topic. "
        "Avoid the broad topic label — it returns generic results. Prefer "
        "tool names, product names, frameworks, version numbers, and "
        "specific subtopics derived from the user's library."
    )
    user = (
        f"Topic label: {theme_label}\n\n"
        f"Recent card titles in this topic:\n{titles or '(none)'}\n\n"
        f"Sample summaries:\n{summaries or '(none)'}\n\n"
        f"Key entities mentioned: {entities}\n\n"
        f"Return JSON: {{\"queries\": [\"q1\", \"q2\", \"q3\"]}}. Each query "
        f"is 3–7 words, no quotes, no boolean operators."
    )
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        qs = [str(q).strip() for q in (data.get("queries") or []) if str(q).strip()]
        return qs[:DISCOVER_QUERIES_PER_THEME] or [theme_label]
    except Exception as exc:  # OpenAI failure shouldn't break Discover
        logger.warning("Discover query LLM failed for %r: %s", theme_label, exc)
        return [theme_label]


def _diversify_by_channel(
    items: list[SuggestionItem], max_per_channel: int = DISCOVER_MAX_PER_CHANNEL
) -> list[SuggestionItem]:
    """Limit how many videos from the same channel get through.

    A spammy channel can otherwise dominate the entire theme. Preserves
    the input order so the higher-ranked items in each query keep their
    edge.
    """
    counts: dict[str, int] = {}
    out: list[SuggestionItem] = []
    for it in items:
        c = (it.channel or "").lower()
        if counts.get(c, 0) >= max_per_channel:
            continue
        counts[c] = counts.get(c, 0) + 1
        out.append(it)
    return out


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

    items, _ = _search_youtube(query)
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


def _build_theme_pool(
    db: Session,
    user_id: UUID,
    theme: ThemeInfo,
    ui_lang: str,
    published_after_days: int | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    """Run the v2 algorithm for one theme and return (queries, results-pool).

    1. Sample representative cards → context for the LLM.
    2. gpt-5.4-mini → 3 specific search queries.
    3. Per query: search.list with hard filters (duration, freshness).
    4. Merge, dedupe by video_id, diversify by channel, cap to pool size.
    """
    context = _gather_theme_context(db, user_id, theme.descendant_tag_ids)
    queries = _generate_discover_queries(theme.label, context)

    all_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for q in queries:
        items, _next = _search_youtube(
            q,
            max_results=DISCOVER_PER_QUERY,
            video_duration=DISCOVER_VIDEO_DURATION,
            published_after_days=published_after_days,
            relevance_language=ui_lang,
        )
        for it in items:
            vid = (it.get("id") or {}).get("videoId")
            if not vid or vid in seen_ids:
                continue
            seen_ids.add(vid)
            all_items.append(it)

    video_ids = [
        ((it.get("id") or {}).get("videoId"))
        for it in all_items
        if (it.get("id") or {}).get("videoId")
    ]
    saved_map = _dedupe_against_library(db, user_id, video_ids)
    duration_map = {
        ((it.get("id") or {}).get("videoId")): it.get("_duration_iso")
        for it in all_items
        if it.get("_duration_iso")
    }
    parsed_objs = _parse_search_items(all_items, duration_map, saved_map)
    parsed_objs = _diversify_by_channel(parsed_objs)
    pool = [s.as_dict() for s in parsed_objs[:DISCOVER_POOL_SIZE]]
    return (queries, pool)


def search_custom(
    db: Session,
    user_id: UUID,
    query: str,
    *,
    freshness: str = DEFAULT_FRESHNESS,
    ui_lang: str = "en",
    force_refresh: bool = False,
) -> tuple[list[dict[str, Any]], bool]:
    """User-typed query that bypasses the LLM + theme clustering.

    Used by the Discover page's inline search bar — applies the same
    duration/freshness filters and library-dedup as the auto themes,
    but with the raw user query verbatim. Cached per (user, query,
    freshness) so re-clicking a recent-search chip is free.
    """
    settings = get_settings()
    if not settings.youtube_api_key.strip():
        return ([], False)
    q = (query or "").strip()
    if not q:
        return ([], False)

    freshness_key = freshness if freshness in FRESHNESS_DAYS else DEFAULT_FRESHNESS
    scope_key = f"{q.lower()}:{freshness_key}"
    if not force_refresh:
        cached = _fresh_cache_row(db, user_id, "custom_search", scope_key)
        if cached is not None:
            return (list(cached.results_json), True)

    items, _next = _search_youtube(
        q,
        max_results=DISCOVER_POOL_SIZE,
        video_duration=DISCOVER_VIDEO_DURATION,
        published_after_days=FRESHNESS_DAYS[freshness_key],
        relevance_language=ui_lang,
    )
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
    parsed_objs = _parse_search_items(items, duration_map, saved_map)
    parsed_objs = _diversify_by_channel(parsed_objs)
    pool = [s.as_dict() for s in parsed_objs[:DISCOVER_POOL_SIZE]]
    _write_cache(db, user_id, "custom_search", scope_key, q, pool)
    return (pool, False)


def discover_for_user(
    db: Session,
    user_id: UUID,
    *,
    force_refresh: bool = False,
    ui_lang: str = "en",
    freshness: str = DEFAULT_FRESHNESS,
) -> list[dict[str, Any]]:
    """Return a list of theme bundles for the Discover page.

    Each bundle: {slug, label, query, queries, card_count, results,
    from_cache, freshness}. `query` is a ' || '-joined string of the
    queries for backwards-compat; `queries` is the explicit list.

    `freshness` is a preset name (see FRESHNESS_DAYS) — unknown values
    fall back to the default. The cache scope_key embeds the freshness
    so each preset has its own 24 h cache lane.
    """
    settings = get_settings()
    if not settings.youtube_api_key.strip():
        return []

    freshness_key = freshness if freshness in FRESHNESS_DAYS else DEFAULT_FRESHNESS
    published_after_days = FRESHNESS_DAYS[freshness_key]

    themes = discover_themes(db, user_id)
    out: list[dict[str, Any]] = []
    for theme in themes:
        scope_key = f"{theme.slug}:{freshness_key}"
        if not force_refresh:
            cached = _fresh_cache_row(db, user_id, "discover_theme", scope_key)
            if cached is not None:
                cached_queries = (cached.query or theme.label).split(" || ")
                out.append(
                    {
                        "slug": theme.slug,
                        "label": theme.label,
                        "query": cached.query,
                        "queries": cached_queries,
                        "card_count": theme.card_count,
                        "results": list(cached.results_json),
                        "from_cache": True,
                        "freshness": freshness_key,
                    }
                )
                continue

        queries, pool = _build_theme_pool(
            db, user_id, theme, ui_lang, published_after_days
        )
        joined_query = " || ".join(queries)
        _write_cache(db, user_id, "discover_theme", scope_key, joined_query, pool)
        out.append(
            {
                "slug": theme.slug,
                "label": theme.label,
                "query": joined_query,
                "queries": queries,
                "card_count": theme.card_count,
                "results": pool,
                "from_cache": False,
                "freshness": freshness_key,
            }
        )
    return out
