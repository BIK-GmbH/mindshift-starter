"""Card-to-card connection engine.

Combines four signals into a single relevance score per (source_card, candidate_card)
pair. All sub-scores are normalized to [0, 1] and weighted, so the final score is also
in [0, 1].

Signals
-------
- **Semantic similarity** (weight 0.5): cosine similarity between the source card's
  summary embedding and the candidate's summary embedding. The strongest single
  signal — captures topical closeness even without shared keywords.
- **Shared entities** (weight 0.3): sum of relevance_score products across entities
  appearing in both cards, capped at 1.0.
- **Shared tags** (weight 0.15): tanh-shaped count of shared tags.
- **Manual relations** (weight 0.05 boost + reason): explicit `card_relations` rows.

Each connection carries a list of `Reason`s describing why the cards are linked, so
the UI can show "shares concept X" / "0.78 cosine" / etc.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.embedding import Embedding
from app.models.entity import CardEntity, Entity
from app.models.relation import CardRelation
from app.models.tag import CardTag, Tag

W_SEMANTIC = 0.5
W_ENTITY = 0.3
W_TAG = 0.15
W_RELATION = 0.05


@dataclass(slots=True)
class Reason:
    kind: str  # "semantic" | "entity" | "tag" | "relation"
    label: str
    weight: float


@dataclass(slots=True)
class Connection:
    card_id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None
    score: float
    reasons: list[Reason] = field(default_factory=list)


def get_connections(
    db: Session,
    user_id: UUID,
    card_id: UUID,
    *,
    limit: int = 10,
) -> list[Connection]:
    """Return the top-N most-connected cards for the given card, owned by user_id."""
    source = db.get(Card, card_id)
    if source is None or source.user_id != user_id:
        return []

    candidates: dict[UUID, Connection] = {}

    _accumulate_semantic(db, source, candidates, user_id)
    _accumulate_shared_entities(db, source, candidates, user_id)
    _accumulate_shared_tags(db, source, candidates, user_id)
    _accumulate_manual_relations(db, source, candidates, user_id)

    ordered = sorted(candidates.values(), key=lambda c: c.score, reverse=True)
    return ordered[:limit]


# --- accumulators -----------------------------------------------------------


def _ensure(
    candidates: dict[UUID, Connection], card: Card
) -> Connection:
    conn = candidates.get(card.id)
    if conn is None:
        conn = Connection(
            card_id=card.id,
            title=card.title,
            source_type=card.source_type,
            thumbnail_url=card.thumbnail_url,
            score=0.0,
        )
        candidates[card.id] = conn
    return conn


def _accumulate_semantic(
    db: Session, source: Card, out: dict[UUID, Connection], user_id: UUID
) -> None:
    """Use the source card's summary embedding (or first transcript chunk) as anchor."""
    anchor = db.execute(
        select(Embedding)
        .where(Embedding.card_id == source.id)
        .order_by(
            # Prefer summary chunks — they describe the whole card.
            (Embedding.chunk_type == "summary").desc(),
            Embedding.chunk_index.asc(),
        )
        .limit(1)
    ).scalar_one_or_none()
    if anchor is None:
        return

    distance = Embedding.embedding.cosine_distance(anchor.embedding).label("distance")
    summary_pref = (Embedding.chunk_type == "summary").desc()
    rows = db.execute(
        select(Card, distance)
        .join(Embedding, Embedding.card_id == Card.id)
        .where(Card.user_id == user_id)
        .where(Card.id != source.id)
        .order_by(Card.id, summary_pref, distance)
        .distinct(Card.id)
    ).all()

    for card, dist in rows:
        sim = max(0.0, 1.0 - float(dist))
        if sim <= 0.0:
            continue
        conn = _ensure(out, card)
        contribution = sim * W_SEMANTIC
        conn.score += contribution
        conn.reasons.append(
            Reason(kind="semantic", label=f"{int(sim * 100)}% similar", weight=contribution)
        )


def _accumulate_shared_entities(
    db: Session, source: Card, out: dict[UUID, Connection], user_id: UUID
) -> None:
    # Source entities with relevance scores
    source_entities = dict(
        db.execute(
            select(CardEntity.entity_id, CardEntity.relevance_score).where(CardEntity.card_id == source.id)
        ).all()
    )
    if not source_entities:
        return

    # All other (card, entity) pairs that share an entity with source
    rows = db.execute(
        select(Card, Entity, CardEntity.relevance_score)
        .join(CardEntity, CardEntity.card_id == Card.id)
        .join(Entity, Entity.id == CardEntity.entity_id)
        .where(Card.user_id == user_id)
        .where(Card.id != source.id)
        .where(CardEntity.entity_id.in_(source_entities.keys()))
    ).all()

    # Aggregate per candidate
    per_card: dict[UUID, tuple[Card, list[tuple[str, float]]]] = {}
    for card, entity, rel_score in rows:
        src_score = source_entities.get(entity.id) or 0.5
        weight = (rel_score or 0.5) * (src_score or 0.5)
        bucket = per_card.setdefault(card.id, (card, []))
        bucket[1].append((entity.name, float(weight)))

    for card_id, (card, hits) in per_card.items():
        total = min(1.0, sum(w for _, w in hits))
        contribution = total * W_ENTITY
        conn = _ensure(out, card)
        conn.score += contribution
        # show the strongest 2 entities as the reason
        top = sorted(hits, key=lambda h: h[1], reverse=True)[:2]
        conn.reasons.append(
            Reason(
                kind="entity",
                label=f"shares: {', '.join(name for name, _ in top)}",
                weight=contribution,
            )
        )


def _accumulate_shared_tags(
    db: Session, source: Card, out: dict[UUID, Connection], user_id: UUID
) -> None:
    source_tag_ids = [
        tid for (tid,) in db.execute(
            select(CardTag.tag_id).where(CardTag.card_id == source.id)
        ).all()
    ]
    if not source_tag_ids:
        return

    # Aggregate per candidate card id without selecting full Card (avoids
    # eager-loaded Source columns clashing with GROUP BY).
    tag_rows = db.execute(
        select(CardTag.card_id, func.array_agg(Tag.name))
        .join(Tag, Tag.id == CardTag.tag_id)
        .join(Card, Card.id == CardTag.card_id)
        .where(Card.user_id == user_id)
        .where(Card.id != source.id)
        .where(CardTag.tag_id.in_(source_tag_ids))
        .group_by(CardTag.card_id)
    ).all()
    if not tag_rows:
        return

    candidate_ids = [card_id for card_id, _ in tag_rows]
    cards_by_id = {
        c.id: c
        for c in db.execute(select(Card).where(Card.id.in_(candidate_ids))).scalars().all()
    }

    for card_id, names in tag_rows:
        card = cards_by_id.get(card_id)
        if card is None:
            continue
        count = len(names)
        normalized = math.tanh(count / 3.0)  # ~0.32 for 1, ~0.76 for 3
        contribution = normalized * W_TAG
        conn = _ensure(out, card)
        conn.score += contribution
        sample = ", ".join(sorted(names)[:3])
        suffix = "" if count <= 3 else f" +{count - 3}"
        conn.reasons.append(
            Reason(kind="tag", label=f"tags: {sample}{suffix}", weight=contribution)
        )


def _accumulate_manual_relations(
    db: Session, source: Card, out: dict[UUID, Connection], user_id: UUID
) -> None:
    rows = db.execute(
        select(CardRelation, Card)
        .join(
            Card,
            or_(
                and_(CardRelation.from_card_id == source.id, Card.id == CardRelation.to_card_id),
                and_(CardRelation.to_card_id == source.id, Card.id == CardRelation.from_card_id),
            ),
        )
        .where(Card.user_id == user_id)
    ).all()

    for relation, card in rows:
        if card.id == source.id:
            continue
        confidence = relation.confidence if relation.confidence is not None else 1.0
        contribution = float(confidence) * W_RELATION
        conn = _ensure(out, card)
        conn.score += contribution
        conn.reasons.append(
            Reason(kind="relation", label=relation.relation_type, weight=contribution)
        )
