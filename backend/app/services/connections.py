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
from datetime import datetime
from uuid import UUID

import numpy as np
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
W_TAG_ANCESTOR = 0.05  # bonus for cards under the same parent subtree (no direct tag overlap)
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
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class GraphNode:
    id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None
    tags: list[str] = field(default_factory=list)
    degree: int = 0


@dataclass(slots=True)
class GraphEdge:
    source: UUID
    target: UUID
    score: float
    reasons: list[Reason]


@dataclass(slots=True)
class GraphView:
    nodes: list[GraphNode]
    edges: list[GraphEdge]


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
    _accumulate_shared_tag_ancestors(db, source, candidates, user_id)
    _accumulate_manual_relations(db, source, candidates, user_id)

    ordered = sorted(candidates.values(), key=lambda c: c.score, reverse=True)[:limit]

    # Bulk-fetch tags for the returned candidates so the UI can colour them.
    if ordered:
        tag_map = _bulk_card_tags(db, [c.card_id for c in ordered])
        for conn in ordered:
            conn.tags = tag_map.get(conn.card_id, [])
    return ordered


def get_global_graph(
    db: Session,
    user_id: UUID,
    *,
    edges_per_card: int = 5,
    min_score: float = 0.05,
    source_type: str | None = None,
    tags: list[str] | None = None,
    created_after: "datetime | None" = None,
    created_before: "datetime | None" = None,
) -> GraphView:
    """Compute a global view: every user card as a node + symmetric edges.

    Reuses `get_connections` per source card (top-N), merges edges across cards
    using a sorted-pair key to avoid duplicates. Edges below `min_score` are
    dropped to keep the layout readable.

    `tags` filters with OR semantics: a card matches if it carries at least
    one of the given tag names.
    """
    stmt = select(Card).where(Card.user_id == user_id)
    if source_type:
        stmt = stmt.where(Card.source_type == source_type)
    if created_after is not None:
        stmt = stmt.where(Card.created_at >= created_after)
    if created_before is not None:
        stmt = stmt.where(Card.created_at <= created_before)
    if tags:
        normalized = [t.lower() for t in tags if t]
        if normalized:
            stmt = (
                stmt.join(CardTag, CardTag.card_id == Card.id)
                .join(Tag, Tag.id == CardTag.tag_id)
                .where(Tag.name.in_(normalized))
                .distinct()
            )

    cards = db.execute(stmt).scalars().all()
    if not cards:
        return GraphView(nodes=[], edges=[])

    tags_by_card = _bulk_card_tags(db, [c.id for c in cards])
    visible_ids: set[UUID] = {c.id for c in cards}
    nodes_by_id: dict[UUID, GraphNode] = {
        c.id: GraphNode(
            id=c.id,
            title=c.title,
            source_type=c.source_type,
            thumbnail_url=c.thumbnail_url,
            tags=tags_by_card.get(c.id, []),
        )
        for c in cards
    }

    # Bulk path — pre-fetch every signal's source data once and accumulate
    # all pairs in Python. Cuts the previous N+1 storm (157 cards × 5
    # signals × {1-3 SQL queries each} = ~2k roundtrips at 150 cards) down
    # to a handful of bulk queries.
    candidates_per_source = _compute_candidates_bulk(
        db,
        user_id=user_id,
        cards=cards,
        visible_ids=visible_ids,
        tags_by_card=tags_by_card,
    )

    edges: dict[tuple[str, str], GraphEdge] = {}
    for source_id, connections in candidates_per_source.items():
        # Apply edges_per_card cap + min_score per source — matches the
        # legacy per-card top-N + filter behaviour.
        connections = [c for c in connections if c.score >= min_score]
        connections.sort(key=lambda c: c.score, reverse=True)
        for conn in connections[:edges_per_card]:
            a, b = (str(source_id), str(conn.card_id))
            key = (a, b) if a < b else (b, a)
            existing = edges.get(key)
            # Keep the stronger of the two directional views — semantic anchor differs
            # depending on which card is the "source", so a→b and b→a may not match.
            if existing is None or conn.score > existing.score:
                edges[key] = GraphEdge(
                    source=source_id,
                    target=conn.card_id,
                    score=conn.score,
                    reasons=conn.reasons,
                )

    # Compute node degree from the deduped edges
    for edge in edges.values():
        if edge.source in nodes_by_id:
            nodes_by_id[edge.source].degree += 1
        if edge.target in nodes_by_id:
            nodes_by_id[edge.target].degree += 1

    return GraphView(nodes=list(nodes_by_id.values()), edges=list(edges.values()))


def find_shortest_path(
    db: Session,
    user_id: UUID,
    from_id: UUID,
    to_id: UUID,
    *,
    edges_per_card: int = 5,
    min_score: float = 0.05,
    max_hops: int = 6,
) -> list[UUID]:
    """BFS over the global graph to find the shortest path between two cards.

    Returns the path as an ordered list of card UUIDs starting with `from_id`
    and ending with `to_id`, or an empty list if unreachable within `max_hops`.
    """
    if from_id == to_id:
        return [from_id]

    view = get_global_graph(
        db, user_id, edges_per_card=edges_per_card, min_score=min_score
    )
    adj: dict[UUID, set[UUID]] = {n.id: set() for n in view.nodes}
    for edge in view.edges:
        adj.setdefault(edge.source, set()).add(edge.target)
        adj.setdefault(edge.target, set()).add(edge.source)

    if from_id not in adj or to_id not in adj:
        return []

    # Standard BFS keeping the predecessor for path reconstruction.
    visited: dict[UUID, UUID | None] = {from_id: None}
    frontier = [from_id]
    for hop in range(max_hops):
        next_frontier: list[UUID] = []
        for current in frontier:
            for neighbour in adj.get(current, ()):
                if neighbour in visited:
                    continue
                visited[neighbour] = current
                if neighbour == to_id:
                    # Reconstruct path
                    path: list[UUID] = [neighbour]
                    while True:
                        prev = visited[path[-1]]
                        if prev is None:
                            break
                        path.append(prev)
                    return list(reversed(path))
                next_frontier.append(neighbour)
        if not next_frontier:
            break
        frontier = next_frontier
    return []


def _bulk_card_tags(db: Session, card_ids: list[UUID]) -> dict[UUID, list[str]]:
    """Fetch tags for many cards in one round-trip."""
    if not card_ids:
        return {}
    rows = db.execute(
        select(CardTag.card_id, Tag.name)
        .join(Tag, Tag.id == CardTag.tag_id)
        .where(CardTag.card_id.in_(card_ids))
        .order_by(CardTag.card_id, Tag.name)
    ).all()
    out: dict[UUID, list[str]] = {}
    for cid, name in rows:
        out.setdefault(cid, []).append(name)
    return out


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

    # Cross-card similarity uses summary chunks only — they describe the
    # whole card in one shot and there's exactly one per card. Scanning
    # all transcript chunks here was the old hot path (5k+ rows per call,
    # multiplied by N cards in get_global_graph) and contributed ~60% of
    # the global-graph latency at 150+ cards. Cards without a summary
    # chunk (legacy, or still ingesting) silently drop out of the
    # semantic signal — they'll still appear via tag / entity / manual
    # relations.
    distance = Embedding.embedding.cosine_distance(anchor.embedding).label("distance")
    rows = db.execute(
        select(Card, distance)
        .join(Embedding, Embedding.card_id == Card.id)
        .where(Card.user_id == user_id)
        .where(Card.id != source.id)
        .where(Embedding.chunk_type == "summary")
        .order_by(Card.id, distance)
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


def _accumulate_shared_tag_ancestors(
    db: Session, source: Card, out: dict[UUID, Connection], user_id: UUID
) -> None:
    """Bonus for cards under the same parent subtree, when no direct tag overlap exists.

    If two cards already share a leaf tag they get the full `_accumulate_shared_tags`
    score — no need to double-count. This accumulator only fires when both sides have
    DIFFERENT direct tags but those tags share at least one ancestor.

    Example: card A tagged `Finance/Investment`, card B tagged `Finance/Banking`.
    They have no direct tag overlap, but both live under `Finance` — so this
    contributes a small `W_TAG_ANCESTOR` bump.
    """
    source_tag_ids: set[UUID] = {
        tid
        for (tid,) in db.execute(
            select(CardTag.tag_id).where(CardTag.card_id == source.id)
        ).all()
    }
    if not source_tag_ids:
        return

    ancestors_map = _build_ancestors_map(db, user_id)
    source_ancestors: set[UUID] = set()
    for tid in source_tag_ids:
        source_ancestors |= ancestors_map.get(tid, set())
    source_ancestors.difference_update(source_tag_ids)
    if not source_ancestors:
        return

    # All other cards' direct tags
    cand_tag_rows = db.execute(
        select(CardTag.card_id, CardTag.tag_id)
        .join(Card, Card.id == CardTag.card_id)
        .where(Card.user_id == user_id)
        .where(Card.id != source.id)
    ).all()
    cand_tags_map: dict[UUID, set[UUID]] = {}
    for cid, tid in cand_tag_rows:
        cand_tags_map.setdefault(cid, set()).add(tid)
    if not cand_tags_map:
        return

    tag_names = dict(
        db.execute(select(Tag.id, Tag.name).where(Tag.user_id == user_id)).all()
    )

    for cand_id, cand_tags in cand_tags_map.items():
        if cand_tags & source_tag_ids:
            continue  # direct overlap — handled by _accumulate_shared_tags

        cand_ancestors: set[UUID] = set()
        for tid in cand_tags:
            cand_ancestors |= ancestors_map.get(tid, set())

        # Common ancestor IDs across the two cards' full hierarchies.
        source_full = source_tag_ids | source_ancestors
        cand_full = cand_tags | cand_ancestors
        shared = (source_full & cand_full)
        if not shared:
            continue

        contribution = math.tanh(len(shared) / 2) * W_TAG_ANCESTOR
        if contribution < 0.005:
            continue

        card = db.get(Card, cand_id)
        if card is None:
            continue
        conn = _ensure(out, card)
        conn.score += contribution

        sample_names = sorted(
            tag_names.get(tid, "?") for tid in list(shared)[:2]
        )
        conn.reasons.append(
            Reason(
                kind="hierarchy",
                label=f"shares parent: {', '.join(sample_names)}",
                weight=contribution,
            )
        )


def _build_ancestors_map(db: Session, user_id: UUID) -> dict[UUID, set[UUID]]:
    """For each tag of `user_id`, the set of all transitive ancestor tag IDs."""
    rows = db.execute(
        select(Tag.id, Tag.parent_id).where(Tag.user_id == user_id)
    ).all()
    parents: dict[UUID, UUID | None] = {tid: pid for tid, pid in rows}
    cache: dict[UUID, set[UUID]] = {}

    def ancestors(tid: UUID) -> set[UUID]:
        if tid in cache:
            return cache[tid]
        out: set[UUID] = set()
        cursor = parents.get(tid)
        seen: set[UUID] = set()
        while cursor is not None and cursor not in seen:
            out.add(cursor)
            seen.add(cursor)
            cursor = parents.get(cursor)
        cache[tid] = out
        return out

    for tid in parents:
        ancestors(tid)
    return cache


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


# ============================================================================
# Bulk-compute path — used by get_global_graph.
# ============================================================================
# The per-card _accumulate_* path is kept for /api/connections (single source
# card). The global graph reuses the same scoring rules but pre-fetches every
# data source once and runs pure-Python loops over the result, dropping ~2k
# DB roundtrips down to ~6 bulk queries.


def _compute_candidates_bulk(
    db: Session,
    *,
    user_id: UUID,
    cards: list[Card],
    visible_ids: set[UUID],
    tags_by_card: dict[UUID, list[str]],
) -> dict[UUID, list[Connection]]:
    """Compute every source-card's candidate list in one pass.

    Returns dict[source_card_id -> list[Connection]], one entry per visible
    card. Connections are not yet sorted/capped — caller applies edges_per_card
    + min_score.
    """
    card_ids = [c.id for c in cards]
    cards_by_id = {c.id: c for c in cards}

    # Skeleton: every visible card gets an empty candidate map.
    out_per_source: dict[UUID, dict[UUID, Connection]] = {cid: {} for cid in card_ids}

    def ensure(source_id: UUID, target_card: Card) -> Connection:
        bucket = out_per_source[source_id]
        existing = bucket.get(target_card.id)
        if existing is None:
            existing = Connection(
                card_id=target_card.id,
                title=target_card.title,
                source_type=target_card.source_type,
                thumbnail_url=target_card.thumbnail_url,
                score=0.0,
                reasons=[],
                tags=tags_by_card.get(target_card.id, []),
            )
            bucket[target_card.id] = existing
        return existing

    # --- 1. Semantic similarity via summary embeddings ----------------------
    # Single SELECT for every card's summary embedding; the cosine-similarity
    # matrix is then a numpy dot product. 5097-row legacy scan → 1 query.
    sum_rows = db.execute(
        select(Embedding.card_id, Embedding.embedding)
        .where(Embedding.chunk_type == "summary")
        .where(Embedding.card_id.in_(card_ids))
    ).all()
    if sum_rows:
        ordered_ids = [cid for cid, _ in sum_rows]
        # pgvector returns embeddings as plain lists; numpy-normalize once.
        matrix = np.asarray([emb for _, emb in sum_rows], dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normed = matrix / norms
        # Full pairwise cosine similarity. 157×157 fits comfortably in RAM
        # at any realistic card count — 1000 cards is still 4 MB.
        sim_matrix = normed @ normed.T
        for i, source_id in enumerate(ordered_ids):
            if source_id not in out_per_source:
                continue
            row = sim_matrix[i]
            for j, target_id in enumerate(ordered_ids):
                if i == j:
                    continue
                sim = float(row[j])
                if sim <= 0.0:
                    continue
                target_card = cards_by_id.get(target_id)
                if target_card is None or target_id not in visible_ids:
                    continue
                conn = ensure(source_id, target_card)
                contribution = sim * W_SEMANTIC
                conn.score += contribution
                conn.reasons.append(
                    Reason(
                        kind="semantic",
                        label=f"{int(sim * 100)}% similar",
                        weight=contribution,
                    )
                )

    # --- 2. Shared tags + 3. Shared tag ancestors ---------------------------
    # Both share the same source data (CardTag rows + ancestors map), so we
    # pre-fetch once and compute both signals in one nested loop.
    tag_id_rows = db.execute(
        select(CardTag.card_id, CardTag.tag_id)
        .join(Card, Card.id == CardTag.card_id)
        .where(Card.user_id == user_id)
    ).all()
    tag_ids_by_card: dict[UUID, set[UUID]] = {}
    for cid, tid in tag_id_rows:
        tag_ids_by_card.setdefault(cid, set()).add(tid)

    tag_name_by_id: dict[UUID, str] = dict(
        db.execute(select(Tag.id, Tag.name).where(Tag.user_id == user_id)).all()
    )
    ancestors_map = _build_ancestors_map(db, user_id)

    for source_id in card_ids:
        source_tags = tag_ids_by_card.get(source_id, set())
        if not source_tags:
            continue
        source_ancestors: set[UUID] = set()
        for tid in source_tags:
            source_ancestors |= ancestors_map.get(tid, set())
        source_ancestors -= source_tags
        source_full = source_tags | source_ancestors

        for target_id, target_tags in tag_ids_by_card.items():
            if target_id == source_id:
                continue
            if target_id not in visible_ids:
                continue
            target_card = cards_by_id.get(target_id)
            if target_card is None:
                continue

            direct = source_tags & target_tags
            if direct:
                count = len(direct)
                contribution = math.tanh(count / 3.0) * W_TAG
                conn = ensure(source_id, target_card)
                conn.score += contribution
                names = sorted(
                    tag_name_by_id.get(tid, "?") for tid in direct
                )
                sample = ", ".join(names[:3])
                suffix = "" if count <= 3 else f" +{count - 3}"
                conn.reasons.append(
                    Reason(kind="tag", label=f"tags: {sample}{suffix}", weight=contribution)
                )
                continue  # direct overlap — skip the ancestor bonus

            # Tag-ancestor bonus only fires when no direct tag overlap.
            target_ancestors: set[UUID] = set()
            for tid in target_tags:
                target_ancestors |= ancestors_map.get(tid, set())
            target_full = target_tags | target_ancestors
            shared = source_full & target_full
            if not shared:
                continue
            contribution = math.tanh(len(shared) / 2) * W_TAG_ANCESTOR
            if contribution < 0.005:
                continue
            conn = ensure(source_id, target_card)
            conn.score += contribution
            sample_names = sorted(
                tag_name_by_id.get(tid, "?") for tid in list(shared)[:2]
            )
            conn.reasons.append(
                Reason(
                    kind="hierarchy",
                    label=f"shares parent: {', '.join(sample_names)}",
                    weight=contribution,
                )
            )

    # --- 4. Shared entities -------------------------------------------------
    entity_rows = db.execute(
        select(CardEntity.card_id, CardEntity.entity_id, CardEntity.relevance_score, Entity.name)
        .join(Entity, Entity.id == CardEntity.entity_id)
        .join(Card, Card.id == CardEntity.card_id)
        .where(Card.user_id == user_id)
    ).all()
    # Build per-card and per-entity indexes from the same rowset.
    entities_by_card: dict[UUID, dict[UUID, float]] = {}
    cards_by_entity: dict[UUID, list[tuple[UUID, float]]] = {}
    entity_name_by_id: dict[UUID, str] = {}
    for cid, eid, rel, name in entity_rows:
        entities_by_card.setdefault(cid, {})[eid] = float(rel or 0.5)
        cards_by_entity.setdefault(eid, []).append((cid, float(rel or 0.5)))
        entity_name_by_id[eid] = name

    for source_id in card_ids:
        src_entities = entities_by_card.get(source_id, {})
        if not src_entities:
            continue
        # Aggregate hits per candidate card across all shared entities.
        per_target: dict[UUID, list[tuple[str, float]]] = {}
        for eid, src_score in src_entities.items():
            for cid, target_score in cards_by_entity.get(eid, []):
                if cid == source_id or cid not in visible_ids:
                    continue
                weight = (target_score or 0.5) * (src_score or 0.5)
                per_target.setdefault(cid, []).append(
                    (entity_name_by_id.get(eid, "?"), float(weight))
                )
        for target_id, hits in per_target.items():
            target_card = cards_by_id.get(target_id)
            if target_card is None:
                continue
            total = min(1.0, sum(w for _, w in hits))
            contribution = total * W_ENTITY
            conn = ensure(source_id, target_card)
            conn.score += contribution
            top = sorted(hits, key=lambda h: h[1], reverse=True)[:2]
            conn.reasons.append(
                Reason(
                    kind="entity",
                    label=f"shares: {', '.join(name for name, _ in top)}",
                    weight=contribution,
                )
            )

    # --- 5. Manual relations ------------------------------------------------
    relation_rows = db.execute(
        select(CardRelation.from_card_id, CardRelation.to_card_id,
               CardRelation.relation_type, CardRelation.confidence)
    ).all()
    for from_id, to_id, rtype, confidence in relation_rows:
        confidence_val = float(confidence) if confidence is not None else 1.0
        contribution = confidence_val * W_RELATION
        for a, b in ((from_id, to_id), (to_id, from_id)):
            if a not in out_per_source or b not in visible_ids:
                continue
            target_card = cards_by_id.get(b)
            if target_card is None or a == b:
                continue
            conn = ensure(a, target_card)
            conn.score += contribution
            conn.reasons.append(
                Reason(kind="relation", label=rtype, weight=contribution)
            )

    return {sid: list(bucket.values()) for sid, bucket in out_per_source.items()}
