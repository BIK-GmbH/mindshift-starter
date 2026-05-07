"""OpenAI embeddings + simple character-based chunking."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import get_settings
from app.models.embedding import EMBEDDING_DIMENSIONS

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
CHUNK_TARGET_CHARS = 1500   # ≈ 350-400 tokens — balances retrieval precision and cost
CHUNK_OVERLAP_CHARS = 200
EMBED_BATCH_SIZE = 64


@dataclass(slots=True)
class TextChunk:
    text: str
    index: int


def chunk_text(text: str, target_chars: int = CHUNK_TARGET_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[TextChunk]:
    """Split text into overlapping chunks of roughly `target_chars` characters."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= target_chars:
        return [TextChunk(text=text, index=0)]

    chunks: list[TextChunk] = []
    start = 0
    idx = 0
    while start < len(text):
        end = min(start + target_chars, len(text))
        # Prefer to break at the next paragraph/sentence boundary inside the trailing 20% window.
        if end < len(text):
            window_start = max(end - target_chars // 5, start + 1)
            for sep in ("\n\n", ". ", "\n"):
                pos = text.rfind(sep, window_start, end)
                if pos != -1:
                    end = pos + len(sep)
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(TextChunk(text=chunk, index=idx))
            idx += 1
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of strings via OpenAI. Empty input returns []."""
    if not texts:
        return []

    from openai import OpenAI

    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    client = OpenAI(api_key=settings.openai_api_key)
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        for d in response.data:
            vec = list(d.embedding)
            if len(vec) != EMBEDDING_DIMENSIONS:
                raise RuntimeError(
                    f"Embedding dimension mismatch: got {len(vec)}, expected {EMBEDDING_DIMENSIONS}"
                )
            out.append(vec)
    return out


def embed_query(query: str) -> list[float]:
    """Embed a single search query."""
    vectors = embed_texts([query])
    if not vectors:
        raise ValueError("Empty query")
    return vectors[0]
