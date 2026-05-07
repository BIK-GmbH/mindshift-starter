# Edge Engine — How Mindshift Decides Two Cards Are Connected

Mindshift's knowledge graph is built on a **single relevance score** computed
for every ordered pair `(source_card, candidate_card)` of a user's library.
The score is in `[0, 1]` and combines five signals, each normalized into the
same range and then weighted.

Implementation: `backend/app/services/connections.py` (functions
`get_connections` and `get_global_graph`).

## Signals

| Signal | Weight | Source | What it captures |
|---|---|---|---|
| **Semantic similarity** | `0.50` | `pgvector` cosine distance between the cards' summary embeddings (`text-embedding-3-small`) | Topical closeness even when no tags or entities overlap. |
| **Shared entities** | `0.30` | OpenAI-extracted `entities` table; intersection per pair, weighted by `relevance_score` | Two cards talking about the same concrete things (people, models, products, concepts). |
| **Shared tags (direct)** | `0.15` | `card_tags` direct overlap | Two cards the user explicitly grouped under the same leaf tag. |
| **Shared tag ancestor** | `0.05` | `tags.parent_id` walk | Two cards under the same parent subtree, even if their leaf tags differ. *Only fires when there is no direct tag overlap.* |
| **Manual relations** | `0.05` | `card_relations` rows the user (or system) explicitly created | Curator-editable, typed connections (`mentions`, `similar_to`, …). |

**Sum of weights = 1.05.** That is intentional: the hierarchy boost stacks
*on top of* a regular score, so two cards that already share a leaf tag don't
benefit from also sharing the parent — they're already directly connected.

## Per-signal formulas

### Semantic
```
sim   = 1 - cosine_distance(source_embedding, candidate_embedding)
score = max(0, sim) * 0.50
```
The anchor for each card is its `summary` chunk if present, otherwise the first
transcript chunk.

### Shared entities
```
total = Σ (source.relevance_score(e) * candidate.relevance_score(e))  for each shared e
total = min(1.0, total)
score = total * 0.30
```

### Shared tags (direct)
```
n     = |source.tags ∩ candidate.tags|                # direct intersection
score = tanh(n / 3) * 0.15
```
Saturating curve: 1 shared tag ≈ 0.05, 3 shared ≈ 0.11, more taper off.

### Shared tag ancestor (the hierarchy boost)
Only computed when **direct tag overlap is empty.**

```
source_full    = source.tags ∪ ancestors(source.tags)
candidate_full = candidate.tags ∪ ancestors(candidate.tags)
shared         = source_full ∩ candidate_full
score          = tanh(|shared| / 2) * 0.05
```

Example:
- Card A tagged `Finance/Investment`
- Card B tagged `Finance/Banking`
- They share **no leaf tag** but both live under `Finance`
- `tanh(1/2) * 0.05 ≈ 0.023` added to the edge

Cards that already share a leaf tag do **not** get this boost.

### Manual relations
```
score = relation.confidence * 0.05      (defaulting to 1.0 if confidence is null)
```

## When changes propagate

The graph is **lazy / on-demand.** `GET /api/graph` recomputes everything
from scratch on each call. There is no cache.

| User action | Effect on the graph |
|---|---|
| Rename tag | None. Edges are based on tag IDs; only labels change. |
| Re-parent tag | Affects the **hierarchy boost** for affected cards. Reflected on next graph fetch. |
| Drag card → new tag | Affects **shared tags** and possibly **hierarchy boost**. Reflected on next graph fetch. |
| Card ingestion / re-ingest | New embeddings + entities + tags, all signals can change. |

## Reasons in the response

Each `GraphEdge` carries a list of `Reason`s with `{kind, label, weight}`.
Possible kinds:

- `semantic` — `"45% similar"`
- `entity` — `"shares: GPT-4, Transformer"`
- `tag` — `"tags: ai, transformers +1"`
- `hierarchy` — `"shares parent: Finance"`
- `relation` — `"manual_link"` (or whatever `relation_type`)

The frontend uses these to populate hover-tooltips on the graph and the
inline reasons pill.

## Tuning

If you want a different mix, change the constants at the top of
`connections.py`:

```python
W_SEMANTIC      = 0.5
W_ENTITY        = 0.3
W_TAG           = 0.15
W_TAG_ANCESTOR  = 0.05
W_RELATION      = 0.05
```

`min_score` (default `0.05`) cuts off the long tail of weak edges in the
global graph for readability.
