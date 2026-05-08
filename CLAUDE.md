# CLAUDE.md — Project memory for Mindshift

This file orients an AI assistant (or a new contributor) before they touch
the codebase. Keep it short, factual, and updated when conventions shift.

## What this is

**Mindshift** is a self-hosted, Recall-inspired AI knowledge base. Users save
YouTube videos, web articles and PDFs; the backend ingests, summarises and
embeds them; the frontend lets the user search, chat-with, review (spaced
repetition) and visualise their knowledge as a graph.

PRD: `docs/PRD.md` (English) and `docs/PRD.de.md` (German).

## Tech stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + SQLAlchemy 2 + Alembic |
| DB | PostgreSQL 16 with **pgvector** (1536-dim embeddings) |
| Auth | JWT (HS256) + bcrypt |
| AI | OpenAI — `gpt-5.4-mini` for chat & summary, `text-embedding-3-small` for embeddings |
| Ingestion | `youtube-transcript-api` 1.x, `pypdf` 6.x, `trafilatura` 2.x |
| Frontend | React 18 + Vite + TypeScript + Tailwind + i18next (DE/EN) |
| Tags tree | `react-arborist` (NOT `@dnd-kit` — that was tried and replaced) |
| Graph | `react-force-graph-2d` (Canvas, force layout) |
| Icons | `lucide-react` |

## Run locally

```bash
cp .env.example .env       # set OPENAI_API_KEY
./scripts/start.sh         # postgres (docker), backend :8001, frontend :5173
./scripts/stop.sh          # clean shutdown
```

The start script is hardened against the common "another uvicorn is on 8001"
mistake — it refuses to start instead of silently swallowing the error.

**Seeded test account** (re-create with `seed_ai_videos.py` if needed):
- Email: `chris@example.com`
- Password: `testpass1234`

## Repo layout

```
backend/app/
  api/            FastAPI routers — one file per concern (auth, cards, tags, …)
  services/       Business logic (ingestion, openai_summarizer, connections, …)
  models/         SQLAlchemy ORM models, one per file
  schemas/        Pydantic request/response models
  migrations/     Alembic — add a new revision per schema change
  scripts/        One-off CLI tools (seed_ai_videos, backfill_embeddings)

frontend/src/
  pages/          Route components (Library, Search, Review, Chat, Graph, …)
  components/     Shared widgets (TagsTree, ChatPanel, CardGraph, …)
  lib/api.ts      Single source of truth for API calls + interfaces
  lib/graphColors.ts   Source-type ↔ tag colour helpers
  locales/        de.json / en.json — i18next keys, must stay in sync
  styles.css      Tailwind base + custom scrollbars + small keyframes

docs/
  PRD.md / PRD.de.md  Original product brief
  edge-engine.md      How the knowledge-graph edge score works
```

## Architecture cheatsheet

- **Auth**: `/api/auth/{register,login,me}` returns a JWT. All other endpoints
  require `Authorization: Bearer …` and resolve `current_user` via
  `app/api/deps.py`.

- **Card lifecycle**: `POST /api/cards/from-{youtube,url,pdf}` creates a Card
  in `queued` status and a Job; FastAPI `BackgroundTasks` then runs
  `services/ingestion.py` which: fetches metadata, extracts text, calls
  OpenAI for the structured summary, persists embeddings, attaches tags,
  entities and quiz questions, marks the card `completed`.

- **Edge engine** (knowledge graph): five signals — semantic, shared
  entities, shared tags, shared tag ancestor, manual relations. Full
  description in `docs/edge-engine.md`. Lazy: `/api/graph` recomputes on
  each call.

- **Tag hierarchy**: `tags.parent_id` (self-FK, ON DELETE SET NULL).
  Backend enforces no cycles when reparenting via PATCH. Frontend uses
  `react-arborist` and disables invalid drops in `disableDrop`.

- **Layout pattern**: every page that scrolls follows the same shape — a
  flex column with a `flex-shrink-0` sticky header band and a
  `flex-1 overflow-y-auto` content area. `CardDetailPage.tsx` is the
  reference. The `<main>` in `AppLayout.tsx` uses `overflow-hidden` so each
  page owns its scroll.

- **Two-sidebar layout**: 56 px icon rail + 240 px context sidebar (tags
  tree, only on `/`). `AppLayout.tsx` decides which to show.

## Conventions

- **Commits**: English, conventional-commits (`feat:`, `fix:`, `chore:`,
  `refactor:`, `ui:`, `docs:`). One logical change per commit.
- **Comments / commit body**: English. UI strings: DE + EN via i18next.
- **No `console.log` / `print` in production code.** No commented-out
  blocks — git remembers.
- **Never commit `.env`.** It is gitignored. The OpenAI key lives there only.
- **i18n**: every user-facing string goes through `t()`. Add the key to
  *both* `de.json` and `en.json` in the same commit.
- **Custom scrollbars**: defined in `styles.css` and inherited globally —
  don't override per component.
- **Sticky-header pages**: copy the structure from `CardDetailPage.tsx`.

## Adding things

### A new DB migration
```bash
cd backend
.venv/bin/alembic revision -m "what changed"
# edit the new file under app/migrations/versions/
.venv/bin/alembic upgrade head
```

### A new API route
1. Add a router file under `backend/app/api/`.
2. Register it in `backend/app/main.py` with `app.include_router(...)`.
3. Add Pydantic schemas under `backend/app/schemas/`.

### A new frontend page
1. Add the component under `frontend/src/pages/`.
2. Wire the route in `frontend/src/App.tsx` and the icon-rail in
   `frontend/src/components/AppLayout.tsx`.
3. Add locale keys to both `de.json` and `en.json`.
4. Use the sticky-header layout pattern.

### A new card-detail tab
1. Add the tab id to the `Tab` union in `CardDetailPage.tsx`.
2. Add an icon to `TAB_ICONS`.
3. Add the rendered branch under the tab content.
4. Add the `card.<id>` key to both locale files.

## Things that already tripped us up

- **`Edit` requires a prior `Read` of the file in the same conversation
  turn.** If the assistant attempts to edit without reading first, the call
  fails — re-read then edit.
- **Vite optimize cache** can become stale after dependency changes
  (`npm install`/`uninstall`). Symptom: blank page + 504 on
  `react-arborist.js`. Fix: `./scripts/stop.sh && ./scripts/start.sh`.
- **`youtube-transcript-api 0.6.x`** broke against current YouTube — pinned
  to `1.2.x` which uses `YouTubeTranscriptApi().fetch(video_id, languages=…)`.
- **`passlib + bcrypt 4.x`** are incompatible — we removed passlib and use
  the `bcrypt` module directly in `app/core/security.py`.
- **Programmatic clicks on canvas elements** (force-graph, react-arborist)
  often don't trigger D3/dnd events. Visually verify in the browser; don't
  rely on synthetic `MouseEvent`s for E2E.

## Recent design decisions

- **Tags hierarchical** with `parent_id`, Recall-style. Cards appear as
  leaves under their tags in the Library sidebar (`react-arborist`).
- **Hierarchy boost in the edge engine**: cards that share a parent
  subtree but no leaf tag get `+0.05 × tanh(n/2)`. See
  `docs/edge-engine.md`.
- **Auto-tagging with hierarchy**: the OpenAI prompt receives the
  user's existing top-level tags as context and may suggest tags as
  `parent/child` slugs (e.g. `finance/investment`). `_attach_tags`
  parses the slash, creates missing parents idempotently, attaches the
  card to the **leaf** only. If an existing leaf tag has no parent
  yet, it adopts the AI's suggested parent — manually-set parents are
  never overwritten.
- **Two-sidebar layout** with the tags tree only visible on Library.
- **`react-arborist`** chosen over `@dnd-kit/core` for the tree because
  the hand-rolled drag layer was fragile (clicks vs drags, cycle
  prevention, no overlay).

## Where to look first

- "Why didn't an edge appear?" → `services/connections.py` and
  `docs/edge-engine.md`.
- "Why did ingestion fail?" → `services/ingestion.py` plus the card's
  `error_message`, plus the `jobs` table.
- "Why does the Card Detail look broken?" → `pages/CardDetailPage.tsx` is
  the reference layout for sticky-header + scrollable content.
- "Tag tree feels off" → `components/TagsTree.tsx` (note the
  `disableDrop` predicate for valid drops).
