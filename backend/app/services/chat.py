"""Chat orchestration: per-card and KB-wide RAG, optionally augmented
with Brave web search."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.card import Card
from app.models.embedding import Embedding
from app.services import web_search
from app.services.embeddings import embed_query

logger = logging.getLogger(__name__)

DEFAULT_CHAT_MODEL = "gpt-5.4-mini"
TOP_K_DEFAULT = 5
CARD_CHUNK_LIMIT = 8


CARD_SYSTEM_PROMPT = """You are Mindshift, a helpful assistant. Answer the user's questions
strictly based on the source content below. If the answer is not contained in the content,
say so honestly. Reply in the user's language."""

KB_SYSTEM_PROMPT = """You are Mindshift, a helpful assistant. The user asks questions about
their personal knowledge base. Use ONLY the retrieved snippets below as your factual ground
truth. Cite sources inline as [#1], [#2], etc., matching the snippet numbers. If the snippets
do not contain the answer, say so honestly. Reply in the user's language."""


@dataclass(slots=True)
class ChatMessage:
    role: str  # "user" | "assistant"
    content: str


@dataclass(slots=True)
class Citation:
    index: int
    card_id: UUID
    title: str
    source_type: str
    chunk_index: int | None
    snippet: str


@dataclass(slots=True)
class WebCitation:
    index: int
    title: str
    url: str
    description: str
    age: str | None


@dataclass(slots=True)
class ChatResult:
    answer: str
    citations: list[Citation] = field(default_factory=list)
    web_citations: list[WebCitation] = field(default_factory=list)


def _client():
    from openai import OpenAI

    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    return OpenAI(api_key=settings.openai_api_key), settings


def _to_openai_messages(history: list[ChatMessage], system_prompt: str) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for m in history:
        if m.role not in {"user", "assistant"}:
            continue
        messages.append({"role": m.role, "content": m.content})
    return messages


def chat_with_card(
    db: Session,
    card: Card,
    history: list[ChatMessage],
    *,
    use_web_search: bool = False,
) -> ChatResult:
    """Answer the user's last message using one card as context.

    With `use_web_search=True`, Brave web-search results for the user's
    latest message are added as a second context block. Web citations
    use a [W#1], [W#2] sequence so the LLM can cite them inline
    distinguishably from card citations.
    """
    if not history:
        raise ValueError("History cannot be empty")
    last_user = next((m for m in reversed(history) if m.role == "user"), None)
    if last_user is None:
        raise ValueError("History contains no user message")

    chunks = _retrieve_card_chunks(db, card, last_user.content)
    context_block = _format_card_context(card, chunks)

    web_citations: list[WebCitation] = []
    web_block = ""
    if use_web_search:
        web_citations = _web_lookup(last_user.content)
        web_block = _format_web_context(web_citations)

    system_prompt = (
        f"{CARD_SYSTEM_PROMPT}\n\n--- SOURCE ---\n{context_block}\n--- END ---"
    )
    if web_block:
        system_prompt += (
            "\n\n--- WEB RESULTS ---\n"
            + web_block
            + "\n--- END ---\n"
            + "Cite web results inline as [W#1], [W#2], etc. when you draw on them."
        )

    client, settings = _client()
    response = client.chat.completions.create(
        model=settings.openai_model or DEFAULT_CHAT_MODEL,
        messages=_to_openai_messages(history, system_prompt),
    )
    answer = (response.choices[0].message.content or "").strip()
    return ChatResult(answer=answer, web_citations=web_citations)


def chat_with_kb(
    db: Session,
    user_id: UUID,
    history: list[ChatMessage],
    top_k: int = TOP_K_DEFAULT,
    *,
    use_web_search: bool = False,
) -> ChatResult:
    """Answer the user's last message using RAG over their knowledge base.

    With `use_web_search=True`, Brave web-search results are added alongside
    the KB snippets. If neither source returns anything useful, the LLM is
    still invoked with web results so the user gets a fresh-web answer
    instead of the legacy "no snippets" fallback.
    """
    if not history:
        raise ValueError("History cannot be empty")
    last_user = next((m for m in reversed(history) if m.role == "user"), None)
    if last_user is None:
        raise ValueError("History contains no user message")

    citations = _retrieve_kb_citations(db, user_id, last_user.content, top_k)
    web_citations: list[WebCitation] = []
    if use_web_search:
        web_citations = _web_lookup(last_user.content)

    if not citations and not web_citations:
        return ChatResult(
            answer=(
                "Ich finde dazu keine passenden Stellen in deiner Knowledge Base. "
                "Füge mehr Inhalte hinzu oder formuliere die Frage anders."
            ),
            citations=[],
            web_citations=[],
        )

    parts: list[str] = []
    if citations:
        kb_block = "\n\n".join(
            f"[#{c.index}] ({c.title} — {c.source_type}):\n{c.snippet}" for c in citations
        )
        parts.append("--- SNIPPETS ---\n" + kb_block + "\n--- END ---")
    if web_citations:
        web_block = _format_web_context(web_citations)
        parts.append(
            "--- WEB RESULTS ---\n"
            + web_block
            + "\n--- END ---\n"
            + "Cite web results inline as [W#1], [W#2], etc. when you draw on them."
        )

    system_prompt = KB_SYSTEM_PROMPT + "\n\n" + "\n\n".join(parts)

    client, settings = _client()
    response = client.chat.completions.create(
        model=settings.openai_model or DEFAULT_CHAT_MODEL,
        messages=_to_openai_messages(history, system_prompt),
    )
    answer = (response.choices[0].message.content or "").strip()
    return ChatResult(
        answer=answer,
        citations=citations,
        web_citations=web_citations,
    )


# --- Web search helpers -----------------------------------------------------


def _web_lookup(query: str) -> list[WebCitation]:
    """Fetch top web results for `query` and number them W#1, W#2, …
    Returns an empty list (instead of raising) on transient errors so
    chat keeps working even when Brave is down. A missing BRAVE_API_KEY
    is logged once and returns []."""
    try:
        results = web_search.search(query)
    except web_search.NoApiKey:
        logger.info("web_search requested but BRAVE_API_KEY not configured — skipping")
        return []
    return [
        WebCitation(
            index=i + 1,
            title=r.title,
            url=r.url,
            description=r.description,
            age=r.age,
        )
        for i, r in enumerate(results)
    ]


def _format_web_context(web_citations: list[WebCitation]) -> str:
    """Render web citations as a numbered block for the system prompt."""
    return "\n\n".join(
        f"[W#{c.index}] {c.title}\n  URL: {c.url}\n  {c.description}"
        + (f"\n  Age: {c.age}" if c.age else "")
        for c in web_citations
    )


# --- Retrieval --------------------------------------------------------------


def _retrieve_card_chunks(db: Session, card: Card, query: str) -> list[Embedding]:
    """Pick the most relevant chunks from a single card. Falls back to all chunks for short cards."""
    all_chunks = db.execute(
        select(Embedding).where(Embedding.card_id == card.id).order_by(Embedding.chunk_index)
    ).scalars().all()
    if len(all_chunks) <= CARD_CHUNK_LIMIT:
        return list(all_chunks)

    try:
        query_vec = embed_query(query)
    except Exception:
        return list(all_chunks[:CARD_CHUNK_LIMIT])

    distance = Embedding.embedding.cosine_distance(query_vec).label("distance")
    rows = db.execute(
        select(Embedding, distance)
        .where(Embedding.card_id == card.id)
        .order_by(distance)
        .limit(CARD_CHUNK_LIMIT)
    ).all()
    return [embedding for embedding, _ in rows]


def _retrieve_kb_citations(
    db: Session, user_id: UUID, query: str, top_k: int
) -> list[Citation]:
    try:
        query_vec = embed_query(query)
    except Exception:
        return []

    distance = Embedding.embedding.cosine_distance(query_vec).label("distance")
    stmt = (
        select(Embedding, Card, distance)
        .join(Card, Card.id == Embedding.card_id)
        .where(Card.user_id == user_id)
        .order_by(distance)
        .limit(top_k * 3)  # over-fetch, dedupe per card below
    )
    rows = db.execute(stmt).all()

    citations: list[Citation] = []
    seen_cards: set = set()
    for embedding, card, _dist in rows:
        if card.id in seen_cards:
            continue
        seen_cards.add(card.id)
        snippet = embedding.chunk_text.strip()
        if len(snippet) > 600:
            snippet = snippet[:600].rstrip() + "…"
        citations.append(
            Citation(
                index=len(citations) + 1,
                card_id=card.id,
                title=card.title,
                source_type=card.source_type,
                chunk_index=embedding.chunk_index,
                snippet=snippet,
            )
        )
        if len(citations) >= top_k:
            break
    return citations


def _format_card_context(card: Card, chunks: list[Embedding]) -> str:
    header = f"Title: {card.title}\nSource type: {card.source_type}"
    if card.concise_summary_md:
        header += f"\nSummary: {card.concise_summary_md}"
    body_chunks = "\n\n---\n".join(c.chunk_text for c in chunks)
    return f"{header}\n\n=== Content ===\n{body_chunks}"
