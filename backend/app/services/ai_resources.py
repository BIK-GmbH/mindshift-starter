"""AI-driven discovery of external resources for a card.

This is the *long-tail* counterpart to `link_extractor`: instead of
pulling URLs the creator explicitly wrote into a description or
spoke into a transcript, we ask an LLM to come up with focused
search queries from the card's context (title + summary + tags +
top entities) and run them through Brave Search. The result is the
3–8 most useful third-party resources for the topic — GitHub
repos, official docs, blog posts that elaborate, papers, news.

The shape mirrors `ExtractedLink` so the frontend can list both
side-by-side in the same tab:

    { url, domain, title, snippet, kind: "github" | "doc" | "web" }

Cached on `source.metadata_json["ai_resources"]` for 24 h. A
refresh flag triggers a fresh run for the rare cases where the
first batch wasn't relevant.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.card import Card
from app.models.entity import CardEntity, Entity
from app.models.tag import CardTag, Tag

logger = logging.getLogger(__name__)

QUERIES_PER_CARD = 3
RESULTS_PER_QUERY = 5
TOTAL_RESULTS_CAP = 10
DOC_DOMAINS = {
    "github.com",
    "docs.python.org",
    "developer.mozilla.org",
    "anthropic.com",
    "openai.com",
    "arxiv.org",
    "huggingface.co",
}


def _gather_card_context(db: Session, card: Card) -> dict[str, Any]:
    """Build the LLM input from title + summary + tags + top entities."""
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
            .limit(8)
        )
        .scalars()
        .all()
    )
    return {
        "title": card.title or "",
        "summary": (card.concise_summary_md or "")[:600],
        "tags": [n.split("/")[-1] for n in tag_names if n][:5],
        "entities": list(entity_names),
    }


def _generate_queries(context: dict[str, Any]) -> list[str]:
    """Ask gpt-5.4-mini for 3 specific web-search queries to find
    canonical resources for this card's topic. Falls back to the title."""
    settings = get_settings()
    if not settings.openai_api_key:
        return [context["title"].strip()][:1]

    sys = (
        "You generate web search queries to find authoritative external "
        "resources for a knowledge card. Aim for canonical references — "
        "official GitHub repos, project docs, the original paper, the "
        "creator's blog post. Avoid generic tutorials and clickbait. "
        "Tool / product / paper names from the entities list are gold; "
        "use them verbatim. Three queries, 3–7 words each, no quotes, "
        "no boolean operators."
    )
    user = (
        f"Card title: {context['title']}\n\n"
        f"Summary: {context['summary']}\n\n"
        f"Tags: {', '.join(context['tags']) or '(none)'}\n\n"
        f"Key entities (most relevant first): {', '.join(context['entities']) or '(none)'}\n\n"
        f"Return JSON: {{\"queries\": [\"q1\", \"q2\", \"q3\"]}}."
    )
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        qs = [str(q).strip() for q in (data.get("queries") or []) if str(q).strip()]
        return qs[:QUERIES_PER_CARD] or [context["title"].strip()]
    except Exception as exc:  # OpenAI hiccup shouldn't break the tab
        logger.warning("ai-resources query LLM failed: %s", exc)
        return [context["title"].strip()][:1]


def _classify(domain: str) -> str:
    """Light heuristic to badge each hit in the UI: 'github' / 'doc' / 'web'."""
    d = (domain or "").lower()
    if d == "github.com" or d.endswith(".github.com") or d.endswith(".github.io"):
        return "github"
    if d in DOC_DOMAINS or d.startswith("docs.") or d.startswith("developer."):
        return "doc"
    return "web"


def discover_for_card(
    db: Session,
    card: Card,
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Return up to `TOTAL_RESULTS_CAP` AI-suggested resources.

    Uses Brave Search (BRAVE_API_KEY) — empty list if the key isn't
    configured. Result is the caller's responsibility to persist; we
    don't touch the DB here so the function is reusable from a
    background task too.
    """
    from app.services.web_search import NoApiKey, search

    context = _gather_card_context(db, card)
    if not context["title"]:
        return []

    queries = _generate_queries(context)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for q in queries:
        try:
            results = search(q, count=RESULTS_PER_QUERY)
        except NoApiKey:
            return []
        for r in results:
            if not r.url or r.url in seen:
                continue
            seen.add(r.url)
            from urllib.parse import urlparse

            domain = urlparse(r.url).netloc.lower()
            out.append(
                {
                    "url": r.url,
                    "domain": domain,
                    "title": r.title or domain,
                    "snippet": (r.description or "")[:280],
                    "age": r.age,
                    "kind": _classify(domain),
                    "query": q,
                }
            )
            if len(out) >= TOTAL_RESULTS_CAP:
                break
        if len(out) >= TOTAL_RESULTS_CAP:
            break
    return out


def is_fresh(meta: dict, *, ttl_hours: int = 24) -> bool:
    """Check whether a cached payload (`{ "ai_resources": …, "ai_resources_at": "ISO" }`)
    is still within its 24h TTL."""
    raw = meta.get("ai_resources_at")
    if not raw:
        return False
    try:
        at = datetime.fromisoformat(raw)
    except ValueError:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - at
    return age.total_seconds() < ttl_hours * 3600


def stamp_now() -> str:
    return datetime.now(timezone.utc).isoformat()
