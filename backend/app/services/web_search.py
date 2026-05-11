"""Web search integration via Brave Search API.

Why: the chat panel's "Web search" toggle augments the LLM context with
fresh web results when the user asks about something the knowledge
base alone can't answer (recent events, breaking news, real-time
data). Brave Search was chosen over Tavily / OpenAI's built-in
web_search because it's the cheapest tier (free up to 2k queries/mo)
and returns structured results without LLM-style summarization, so we
can decide how to format them into the prompt ourselves.

Public surface:
    WebResult     — one search result row
    BraveSearch.search(query, count) -> list[WebResult]
    NoApiKey      — raised when BRAVE_API_KEY isn't set; callers should
                    catch and fall back to KB-only chat.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
DEFAULT_COUNT = 5
REQUEST_TIMEOUT_S = 6.0


class NoApiKey(RuntimeError):
    """BRAVE_API_KEY not configured — caller can decide whether to fail
    hard or fall back to KB-only chat."""


@dataclass(slots=True)
class WebResult:
    title: str
    url: str
    description: str
    age: str | None  # Brave returns relative strings like "2 days ago"


def search(query: str, count: int = DEFAULT_COUNT) -> list[WebResult]:
    """Top-K web results for `query`. Empty list on transient errors
    (network blip, rate limit) — chat keeps working even when the web
    leg fails, only the citations are missing."""
    settings = get_settings()
    api_key = (settings.brave_api_key or "").strip()
    if not api_key:
        raise NoApiKey("BRAVE_API_KEY not configured")

    q = (query or "").strip()
    if not q:
        return []

    try:
        resp = httpx.get(
            BRAVE_ENDPOINT,
            params={
                "q": q,
                "count": max(1, min(count, 20)),
                # Skip Brave's optional 'mixed' results (videos, news, etc.)
                # — the chat prompt only needs plain web snippets.
                "result_filter": "web",
            },
            headers={
                "X-Subscription-Token": api_key,
                "Accept": "application/json",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        logger.warning("brave-search request failed: %s", exc)
        return []

    if resp.status_code == 401:
        logger.error("brave-search 401 — check BRAVE_API_KEY")
        return []
    if resp.status_code == 429:
        logger.warning("brave-search 429 — rate limited; skipping web augmentation")
        return []
    if resp.status_code >= 400:
        logger.warning("brave-search %s: %s", resp.status_code, resp.text[:200])
        return []

    try:
        data = resp.json()
    except ValueError:
        logger.warning("brave-search non-JSON response")
        return []

    results: list[WebResult] = []
    for raw in (data.get("web", {}) or {}).get("results", []) or []:
        title = (raw.get("title") or "").strip()
        url = (raw.get("url") or "").strip()
        if not title or not url:
            continue
        description = (raw.get("description") or "").strip()
        age = raw.get("age") or None
        results.append(WebResult(title=title, url=url, description=description, age=age))
    return results
