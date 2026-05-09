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
| AI | OpenAI `gpt-5.4-mini` (chat, summary, AI rewrites, podcast script), `text-embedding-3-small` (embeddings), `gpt-image-2` (podcast cover art) |
| TTS | Google `gemini-3.1-flash-tts-preview` — 24 kHz mono PCM that we wrap into WAV in-process (no ffmpeg). Voices: Kore (default), Puck, Enceladus, Charon, Fenrir |
| Ingestion | `youtube-transcript-api` 1.x, `pypdf` 6.x, `trafilatura` 2.x |
| Frontend | React 18 + Vite + TypeScript + Tailwind + i18next (DE/EN) |
| Editor | TipTap (StarterKit + Link + Placeholder) with markdown round-trip via `marked` + `turndown` |
| Tags tree | `react-arborist` (NOT `@dnd-kit` — that was tried and replaced) |
| Graph | `react-force-graph-2d` (Canvas, force layout) |
| Icons | `lucide-react` |

## Run locally

```bash
cp .env.example .env       # set OPENAI_API_KEY + GEMINI_API_KEY
./scripts/start.sh         # postgres (docker), backend :8001, frontend :5173
./scripts/stop.sh          # clean shutdown
```

`GEMINI_API_KEY` is only needed if you want to use the in-card podcast or
the Podcast Studio. The rest of the app runs on OpenAI alone.

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
  pages/          Route components (Library, Search, Review/Learning, Chat,
                  Graph, Podcasts, PublicEpisode, …)
  components/     Shared widgets (TagsTree, ChatPanel, CardGraph,
                  RichTextEditor, CardPodcastPlayer, …)
  lib/api.ts      Single source of truth for API calls + interfaces
  lib/sounds.ts   Web-Audio-API generated UI sound helpers
  lib/graphColors.ts   Source-type ↔ tag colour helpers
  locales/        de.json / en.json — i18next keys, must stay in sync
  styles.css      Tailwind base + custom scrollbars + animations + tokens

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

- **Two-sidebar layout**: 56 px icon rail + 256 px context sidebar (tags
  tree on `/`, chat history on `/chat`, learning sidebar on `/review`,
  playlists on `/podcasts`). `AppLayout.tsx` decides which to show.

- **Async generation pattern** (in-card podcast, podcast episodes): the
  POST endpoint inserts a row in `status="processing"` and returns 202
  immediately. A FastAPI `BackgroundTask` does the work (Gemini TTS +
  optionally `gpt-image-2`) and updates `status="ready"` / `"failed"`
  on completion. Frontend polls every 4 s while any row is still
  processing — survives client disconnect (not a backend restart).
  `services/podcast.py` chunks long scripts at paragraph boundaries
  (max 1400 chars per Gemini call, 240 s timeout) and concatenates
  raw 24 kHz PCM into one final WAV.

- **Learning Sessions (auto-bucket)**: `submit_answer` calls
  `_bucket_session()` — append to the user's most recent session if
  `ended_at < now - 30 min`, else open a new one. Counters
  (`event_count`, `correct_count`) stay on the session row;
  `review_events.session_id` FK ties each event back. `/review/activity`
  returns per-day aggregates for the GitHub-style heatmap.

- **Episode sharing**: `episode_shares` table holds public tokens
  (`token_urlsafe(18)`). Auth endpoints `/episodes/{id}/share`
  (POST/GET/DELETE) + unauthenticated `/api/public/episodes/{token}`
  (+ `audio.wav` + `cover.png`). Public pages at
  `/share/episode/:token` (full standalone player + OG meta tags) and
  `/embed/episode/:token` (iframe-friendly mini-player).

- **RSS feed subscriptions**: `feeds` table per user (feed_url, title,
  etag/last-modified for conditional GET, last_error, items_ingested).
  The in-process APScheduler in `services/feed_scheduler.py` walks
  every active feed every `FEED_POLL_INTERVAL_MIN` minutes (default 30).
  New entries are deduped against existing `Source.url`/`canonical_url`
  for the same user, then queued through the same article ingestion
  pipeline as `/api/cards/from-url`. Hard cap of 25 brand-new items
  per poll to protect against republished feeds. `POST /api/feeds/
  {id}/refresh` is the manual on-demand pull; new subscriptions get
  an immediate first poll via BackgroundTasks. Polling is fail-soft —
  one feed's HTTP / parse error doesn't block the others.

- **Learning paths**: `paths` + `path_cards` tables; an ordered,
  user-curated sequence of cards. Slug per user (`uq_paths_user_slug`)
  generated from title via `services/paths.slugify` with `-2` / `-3`
  collision suffixes; renaming does NOT regenerate the slug unless
  `regenerate_slug` is requested, so public URLs stay stable. Position
  is dense (0…N-1) and re-numbered on every move/remove via
  `services.paths.renumber_positions`. Owner CRUD lives at
  `/api/paths/*`, public read at `/api/public/paths/{username}/{slug}`.
  Frontend pages: `PathsPage` (list + create), `PathEditPage` (inline-
  edit title/description/cover, public-toggle, drag-free reorder via
  up/down arrows, per-step lesson note, `CardPickerModal` for adding
  cards), `PathPlayerPage` (linear walkthrough with sticky header +
  prev/next + arrow-key navigation, embeds `CardDetailContent` so all
  card features work in player mode), `PublicPathPage` (read-only
  view at `/u/<user>/path/<slug>`).

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
- **gpt-5.4-mini, no `temperature`**: GPT-5 family rejects explicit
  `temperature` arguments. Every `client.chat.completions.create(...)`
  call is parameter-free; we steer behavior with system prompts only.
- **Async pattern, not jobs table**: in-card podcast and podcast
  episodes use a per-row `status` column (`processing`/`ready`/`failed`)
  + `error_message`. The legacy `jobs` table stays for card ingestion;
  new background work uses the simpler row-status pattern with
  `BackgroundTasks` + frontend polling.
- **View Transitions API for editor fullscreen**: rather than FLIP-by-
  hand, the RichTextEditor toggle wraps `setFullscreen` in
  `document.startViewTransition`. Both DOM positions (inline + portal)
  carry `view-transition-name: rte-card`, so the browser morphs the
  bounding box itself. Falls back to a plain state toggle on
  unsupported browsers.
- **TTS chunking**: Gemini reads ~1400 chars per call comfortably.
  Long episode scripts get split at paragraph boundaries (then
  sentence boundaries inside oversized paragraphs); raw 24 kHz PCM
  is concatenated and re-wrapped into one WAV.

## Where to look first

- "Why didn't an edge appear?" → `services/connections.py` and
  `docs/edge-engine.md`.
- "Why did ingestion fail?" → `services/ingestion.py` plus the card's
  `error_message`, plus the `jobs` table.
- "Why does the Card Detail look broken?" → `pages/CardDetailPage.tsx` is
  the reference layout for sticky-header + scrollable content.
- "Tag tree feels off" → `components/TagsTree.tsx` (note the
  `disableDrop` predicate for valid drops).
- "Podcast generation didn't finish" → check the row's `status` and
  `error_message` (`card_audio` or `podcast_episodes`). Background
  task logs go to `.runtime/logs/backend.log`. Common causes: missing
  `GEMINI_API_KEY`, oversized text per chunk (already mitigated by
  paragraph chunking), or a backend restart killing the in-flight
  task.
- "Episode share link 404s" → either revoked (`episode_shares` row
  deleted) or the underlying episode was deleted (cascade dropped
  the share row).
- "Learning history misses an event" → check `review_events.session_id`
  is set; the auto-bucket logic is in `api/review.py::_bucket_session`.
  Old events backfilled via `scripts/backfill_learning_sessions.py`.
