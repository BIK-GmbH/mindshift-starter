from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.embedding import Embedding
from app.models.source import Source
from app.models.transcript import Transcript
from app.models.user import User
from app.schemas.search import SearchHit, SemanticSearchRequest
from app.services.embeddings import embed_query

router = APIRouter(prefix="/search", tags=["search"])

SNIPPET_MAX_CHARS = 320


@router.get("", response_model=list[SearchHit])
def keyword_search(
    q: str = Query(..., min_length=1, max_length=2000),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SearchHit]:
    like = f"%{q}%"
    stmt = (
        select(Card)
        .where(Card.user_id == current_user.id)
        .where(
            or_(
                Card.title.ilike(like),
                Card.concise_summary_md.ilike(like),
                Card.detailed_summary_md.ilike(like),
                Card.notes_md.ilike(like),
            )
        )
        .order_by(Card.updated_at.desc())
        .limit(limit)
    )
    cards = db.execute(stmt).scalars().all()
    hits: list[SearchHit] = [
        SearchHit(
            card_id=card.id,
            title=card.title,
            source_type=card.source_type,
            thumbnail_url=card.thumbnail_url,
            snippet=_make_snippet(card, q),
            chunk_type=None,
            chunk_index=None,
            score=1.0,
            created_at=card.created_at,
        )
        for card in cards
    ]

    # Also search inside transcript segments. Each matching segment
    # becomes its own hit with `timestamp_seconds` set so the UI can
    # render a "▶ 02:34" deep-link. We only return hits for cards the
    # user owns and dedup down to a few per card so a verbose
    # transcript doesn't drown out card-level matches.
    seg_hits = _search_transcript_segments(db, current_user.id, q, limit=limit)
    hits.extend(seg_hits)
    return hits[:limit]


@router.post("/semantic", response_model=list[SearchHit])
def semantic_search(
    payload: SemanticSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SearchHit]:
    try:
        query_vec = embed_query(payload.query)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Embedding failed: {exc}") from exc

    distance = Embedding.embedding.cosine_distance(query_vec).label("distance")
    stmt = (
        select(Embedding, Card, distance)
        .join(Card, Card.id == Embedding.card_id)
        .where(Card.user_id == current_user.id)
        .order_by(distance)
        .limit(payload.limit)
    )
    rows = db.execute(stmt).all()
    hits: list[SearchHit] = []
    seen_cards: set = set()
    for embedding, card, dist in rows:
        if card.id in seen_cards:
            continue
        seen_cards.add(card.id)
        snippet = embedding.chunk_text[:SNIPPET_MAX_CHARS].strip()
        if len(embedding.chunk_text) > SNIPPET_MAX_CHARS:
            snippet += "…"
        hits.append(
            SearchHit(
                card_id=card.id,
                title=card.title,
                source_type=card.source_type,
                thumbnail_url=card.thumbnail_url,
                snippet=snippet,
                chunk_type=embedding.chunk_type,
                chunk_index=embedding.chunk_index,
                score=max(0.0, 1.0 - float(dist)),
                created_at=card.created_at,
            )
        )
    return hits


def _search_transcript_segments(
    db: Session, user_id, query: str, *, limit: int
) -> list[SearchHit]:
    """Scan every transcript with a non-null `segments_json` belonging to
    the user and pick segments whose text contains `query` (case-insensitive).

    Limited to a few hits per card to keep the result list balanced
    when a long video mentions a term repeatedly.
    """
    rows = db.execute(
        select(Transcript, Card, Source)
        .join(Card, Card.id == Transcript.card_id)
        .join(Source, Source.id == Card.source_id, isouter=True)
        .where(
            Card.user_id == user_id,
            Transcript.segments_json.isnot(None),
        )
    ).all()

    needle = query.lower()
    hits: list[SearchHit] = []
    PER_CARD_CAP = 3
    for transcript, card, source in rows:
        segments = transcript.segments_json or []
        per_card = 0
        for seg in segments:
            text = (seg.get("text") or "").strip()
            if not text or needle not in text.lower():
                continue
            start_seconds = int(seg.get("start") or 0)
            video_id = (
                source.external_id
                if source is not None and card.source_type == "youtube"
                else None
            )
            hits.append(
                SearchHit(
                    card_id=card.id,
                    title=card.title,
                    source_type=card.source_type,
                    thumbnail_url=card.thumbnail_url,
                    snippet=text[:SNIPPET_MAX_CHARS],
                    chunk_type="transcript_segment",
                    chunk_index=None,
                    score=0.9,  # below card-level matches but above pure semantic
                    created_at=card.created_at,
                    timestamp_seconds=start_seconds,
                    youtube_video_id=video_id,
                )
            )
            per_card += 1
            if per_card >= PER_CARD_CAP:
                break
        if len(hits) >= limit:
            break
    return hits


def _make_snippet(card: Card, query: str) -> str:
    haystack = card.concise_summary_md or card.detailed_summary_md or card.title
    if not haystack:
        return ""
    haystack_l = haystack.lower()
    idx = haystack_l.find(query.lower())
    if idx == -1:
        return haystack[:SNIPPET_MAX_CHARS]
    start = max(0, idx - 80)
    end = min(len(haystack), idx + len(query) + 240)
    snippet = haystack[start:end].strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(haystack):
        snippet += "…"
    return snippet
