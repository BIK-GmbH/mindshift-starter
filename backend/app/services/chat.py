"""Chat orchestration: per-card and KB-wide RAG."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.card import Card
from app.models.embedding import Embedding
from app.services.embeddings import embed_query

DEFAULT_CHAT_MODEL = "gpt-4o-mini"
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
class ChatResult:
    answer: str
    citations: list[Citation] = field(default_factory=list)


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


def chat_with_card(db: Session, card: Card, history: list[ChatMessage]) -> ChatResult:
    """Answer the user's last message using one card as context."""
    if not history:
        raise ValueError("History cannot be empty")
    last_user = next((m for m in reversed(history) if m.role == "user"), None)
    if last_user is None:
        raise ValueError("History contains no user message")

    chunks = _retrieve_card_chunks(db, card, last_user.content)
    context_block = _format_card_context(card, chunks)

    system_prompt = f"{CARD_SYSTEM_PROMPT}\n\n--- SOURCE ---\n{context_block}\n--- END ---"

    client, settings = _client()
    response = client.chat.completions.create(
        model=settings.openai_model or DEFAULT_CHAT_MODEL,
        messages=_to_openai_messages(history, system_prompt),
        temperature=0.4,
    )
    answer = (response.choices[0].message.content or "").strip()
    return ChatResult(answer=answer)


def chat_with_kb(
    db: Session,
    user_id: UUID,
    history: list[ChatMessage],
    top_k: int = TOP_K_DEFAULT,
) -> ChatResult:
    """Answer the user's last message using RAG over their knowledge base."""
    if not history:
        raise ValueError("History cannot be empty")
    last_user = next((m for m in reversed(history) if m.role == "user"), None)
    if last_user is None:
        raise ValueError("History contains no user message")

    citations = _retrieve_kb_citations(db, user_id, last_user.content, top_k)

    if not citations:
        return ChatResult(
            answer=(
                "Ich finde dazu keine passenden Stellen in deiner Knowledge Base. "
                "Füge mehr Inhalte hinzu oder formuliere die Frage anders."
            ),
            citations=[],
        )

    context_block = "\n\n".join(
        f"[#{c.index}] ({c.title} — {c.source_type}):\n{c.snippet}" for c in citations
    )
    system_prompt = f"{KB_SYSTEM_PROMPT}\n\n--- SNIPPETS ---\n{context_block}\n--- END ---"

    client, settings = _client()
    response = client.chat.completions.create(
        model=settings.openai_model or DEFAULT_CHAT_MODEL,
        messages=_to_openai_messages(history, system_prompt),
        temperature=0.4,
    )
    answer = (response.choices[0].message.content or "").strip()
    return ChatResult(answer=answer, citations=citations)


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
