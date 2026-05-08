# Mindshift — Sprint progress

This file is **owned by the AI assistant** to maintain context across
sessions. It captures the active work plan, what's done, and what's next.

When a new session starts, read this first to know where to pick up.

## Active sprint — Recall-pattern follow-ups

**Status:** Phases 1-37 in flight. Phase 33-37: review/learning rebrand + Learning Sessions (auto-bucketed, history list, drilldown, streak heatmap, resume hint).

| Phase | Status | Description |
|---|---|---|
| 33 | 🚧 | **Rebrand Review → Learning** — user-facing strings (DE+EN), nav icon swapped to `GraduationCap`. Code identifiers (route `/review`, file names) stay for stability. |
| 34 | 🚧 | **Learning Sessions backend** — migration `0012_learning_sessions` adds table + `review_events.session_id` FK. Auto-bucket logic in `submit_answer`: append to user's most recent session if `ended_at` < 30 min ago, else create a new one. Backfill script for existing events. |
| 35 | 🚧 | **Session history list** — sidebar of past sessions (date label, count, correct%), grouped Today/Yesterday/This week/Older. |
| 36 | 🚧 | **Session detail drilldown** — clicking a past session swaps the main column to a SessionDetailView with per-event question, rating, before→after stage, card link. |
| 37 | 🚧 | **Streak heatmap + resume hint** — GitHub-style 7×N year grid driven by `/api/review/activity`; small chip "Continuing 14:32 session" when answering inside the auto-bucket window. |

| Phase | Status | Description |
|---|---|---|
| 29 | ✅ | **Public-edit warning** — `CardOut` returns `is_public` + `public_via_tags` (resolved by walking each public tag tree). Card header gets a green "Public via #tag" pill; the notes editor shows an inline "edits are visible immediately" hint. |
| 30 | ✅ | **OG / Twitter cards** — new `/og/u/:username` and `/og/u/:username/:slug` render crawler-friendly HTML with og:/twitter: meta + refresh-redirect to the SPA. Frontend `setMetaTags` helper mirrors the same tags into `document.head` for JS-aware bots. `docs/DEPLOYMENT.md` documents nginx + Caddy snippets to route social-bot UAs. |
| 31 | ✅ | **RSS feeds per public tag** — `/api/public/users/:username/feeds/:slug.rss` returns RSS 2.0 of the most recent 40 cards in the tag tree. Tag page exposes a subscribe button linked to it. |
| 32 | ✅ | **Anonymous reactions** — `card_reactions` table (migration 0009). `POST /api/public/.../cards/:id/reactions` toggles a reaction (kinds: `like` / `insightful` / `mindblown`), keyed by `sha256(JWT_SECRET + ip)` so we never store raw IPs. 60-per-IP-hour rate limit. `<Reactions>` bar appears below the card body on the public viewer. |

| Phase | Status | Description |
|---|---|---|
| 27 | ✅ | **File storage layer** — pluggable backend (`local` shipped, `s3` reserved). `files` table (migration 0007). Per-user SHA-256 dedupe. PDF uploads persist the original; `cards.original_file_id` links to it. `GET /api/files/{id}` auth-protected download. PDF cards now expose **Download original file** in the export menu. Card delete cascades to file delete (when no other card refers to it). PDF re-ingest works without re-upload. Quota guard `STORAGE_MAX_BYTES_PER_USER`. Railway: point `STORAGE_PATH` at the volume mount, no other change needed. |
| 28 | ✅ | **Public profile + tag sharing** — migration 0008 adds `users.username/bio/avatar_file_id/public_profile` + `tags.is_public`. New auth endpoints: `PATCH /api/auth/me`, `POST /api/auth/me/avatar`, `DELETE /api/auth/me/avatar`. New unauthenticated endpoints: `GET /api/public/users/:username`, `GET /api/public/users/:username/tags/:slug` (recursive sub-tag walk), `GET /api/public/users/:username/cards/:id` (only if reachable via at least one public tag), `GET /api/public/avatars/:file_id`. Frontend: profile fields + avatar upload in Settings → Account; public/private toggle column in Tag Manager; YouTube-channel-style profile page at `/u/:username` and tag detail at `/u/:username/:slug` (multi-segment slug). All public pages set `<meta robots="noindex,nofollow">` until the user opts into SEO. |

| Phase | Status | Description |
|---|---|---|
| 24 | ✅ | **Browser extension** — Manifest V3 popup in `extension/`. "Add this page" → `from-url`/`from-youtube`. "Import bookmarks" → reads `chrome.bookmarks` and POSTs a Netscape-format file to `/api/import/bookmarks`. New `/api/auth/extension-token` mints a 1-year JWT. CORS now allows `(chrome|moz|safari-web)-extension://*` origins. Settings → API & Extension reveals/copies the token. |
| 25 | ✅ | **Markdown rendering** — new `<MarkdownView>` (marked + scoped `.markdown-body` styles) renders detailed_summary_md and notes_md in card detail and the public viewer. |
| 26 | ✅ | **Copy variants** — `<ExportMenu>` dropdown in the card-detail action bar with Copy markdown / Copy plain text / Download .md. Plain-text path uses `markdownToPlainText` to strip md syntax. |

| Phase | Status | Description |
|---|---|---|
| 18 | ✅ | **TipTap rich-text editor** — `<RichTextEditor>` with markdown round-trip via `marked` + `turndown`. Used in Add Content note tab + card detail notes tab. Toolbar: H2, bold, italic, strike, lists, quote, inline code, link. |
| 19 | ✅ | **Web Share API** — public `/share/:token` page has a Share button using `navigator.share()` on mobile, copy-to-clipboard fallback on desktop. |
| 20 | ✅ | **Bookmarks UX** — drag-and-drop file dropzone on import tiles, expandable "How do I export bookmarks" hint with Chrome/Edge/Firefox/Safari instructions, focus-visible rings. URL examples are now buttons that prefill sample patterns. |
| 21 | ✅ | **Pane animations** — `.pane-enter-right` slide+fade for chat side pane; sidebars hidden on narrow viewports (`md:flex`). `prefers-reduced-motion` global override drops every animation to ~instant. |
| 22 | ✅ | **Graph fixes** — request-id ref kills stale fetches that caused the "double load" flash; new node-spacing slider (0–100) maps to d3 linkDistance 30→250 px and charge -50→-400. Persisted to localStorage. |
| 23 | ✅ | **UI/UX audit** — global `:focus-visible` ring; quiz empty/processing states; `Reveal` + `TL;DR` + `Sources` + `PDF max 25 MB` + notes placeholder all moved to i18n; SettingsModal joined the modal-pop animation; chat session delete button is touch-visible (max-sm:opacity-100); chat loading replaced with skeleton; Brain logo + graph control buttons got aria-labels; AuthPage `focus:` → `focus-visible:`; CardTile got `aria-label`. |

| Phase | Status | Description |
|---|---|---|
| 11 | ✅ | **Add Content modal** — Recall-style with backdrop blur + 5 tabs (URL / Wiki / PDF / Import / Note). YouTube vs. article URL is auto-detected. |
| 12 | ✅ | **Light-mode hover** — `hover:bg-white` swept to `hover:bg-ink-200` across 7 components so primary buttons stay readable in light mode. |
| 13 | ✅ | **Wiki import** — `/api/wiki/search` proxies `en/de.wikipedia.org/w/api.php?action=opensearch`; debounced live search lands article URLs straight into ingestion. |
| 14 | ✅ | **Note creation** — `POST /api/cards/from-note` + `process_note_card`; tab supports optional AI summary on save. |
| 15 | ✅ | **Browser bookmarks import** — `POST /api/import/bookmarks` parses Netscape-format HTML into per-URL ingestion jobs (cap 500). |
| 16 | ✅ | **Markdown import** — `POST /api/import/markdown` accepts a ZIP of `.md` files, takes title from first H1 or filename. |
| 17 | ✅ | **Share feature** — `card_shares` table (migration 0006), share/revoke endpoints, public read-only viewer at `/share/:token`. Share modal in card detail header with copy + revoke. |

| Phase | Status | Description |
|---|---|---|
| 7 | ✅ | **Global search modal** — Recall-style modal opened via header trigger / outer-rail icon / `cmd+K` / `/`. Text + AI toggle, debounced search, ↑↓/Enter result navigation. Standalone `/search` route retired. |
| 8 | ✅ | **Micro-animations** — `.page-enter` (route fade), `.modal-card-enter` + `.modal-backdrop-enter`, refined `.card-hover` with theme-aware shadow. All CSS-only. |
| 9 | ✅ | **Graph label theme-awareness** — both `CardGraph` and `GraphPage` read `useTheme()` and pass dark label text in light mode, near-white in dark. |
| 10 | ✅ | **Conversation auto-title** — `_title_from_message` trims at the last word boundary inside the cap and adds an ellipsis. No more mid-word splits. |

Goal: bring the rest of the app up to the Recall-style shell that
`fb2d44c` introduced. Six phases, in order. Each phase ends with a
commit + push and a verified browser test.

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | **Light-mode polish** — tuned the light ink scale for more contrast in mid-tones; theme-aware graph canvas backgrounds (CardGraph, GraphPage). |
| 2 | ✅ | **Graph context sidebar** — Recall-style left sidebar with Search / Filters (source, tag, hide-isolated) / Display (color-by + legend) / Tools (path, timeline) / Stats footer. |
| 3 | ✅ | **Chat conversation history** — backend `chat_sessions` + `chat_messages` tables (migration 0005), CRUD endpoints under `/api/chat/sessions`, persistence wired into both `/api/chat` and `/api/cards/{id}/chat`. ChatPage now has a Recall-style sidebar grouping sessions by day; click loads a conversation, delete removes it. |
| 4 | ✅ | **Tag manager** — new "Tags" tab in the settings modal. Lists all tags hierarchically with card-counts; supports add (form), rename (prompt), parent-reparent (select with cycle prevention), and delete (confirm). |
| 5 | ✅ | **Bulk re-tag** — `app.scripts.retag_existing` re-runs the AI tagging on completed cards. Supports `--user-email`, `--limit`, `--dry-run`, `--replace`. Reuses the hierarchical-tag prompt + user's existing top-level tags as context. |
| 6 | ✅ | **KB Markdown export** — `GET /api/export/markdown` streams a ZIP of one Markdown file per card (TL;DR + key takeaways + summary + notes + transcript), organised in folders that mirror the tag hierarchy. Untagged cards land in `_untagged/`. Frontend trigger in Settings → Account → DATA → Export. |

## Working agreement

- One commit per phase. Conventional Commits. English bodies.
- Every phase ends with browser verification (Playwright MCP) — both
  golden path and one regression check on adjacent features.
- i18n: every new user-facing string lands in *both* `de.json` and
  `en.json` in the same commit.
- Backend: any schema change is a new Alembic revision, not an inline
  edit of an existing migration.
- Tests: backend changes get a smoke test via `curl` against the
  running API; frontend changes get a Playwright snapshot+screenshot.

## Done in this branch (most recent first)

- `fb2d44c` — Recall-style shell: outer-rail footer with theme/lang/settings, settings modal with backdrop blur, light/dark theme via CSS-variable token swap, per-page context-sidebar pattern, tab scrollbar bug fix.
- `e411fd6` — `/cards/:id` shrunk to a redirect into the inline library detail.
- `e3810ab` — Library inline master-detail layout with chat side pane.
- `38ce2e7` — hierarchical auto-tagging via OpenAI prompt.
- `ca8638b` — graph hierarchy boost + project docs.
- `4c90896` — TagsTree migrated to react-arborist.

## How to resume after a session break

1. `git log --oneline -10` to see latest progress.
2. Read this file's status table — first ⬜ row is the next task.
3. The phase descriptions above are intentionally short. The full
   intent is in the conversation that opened the sprint
   (CardDetailPage refactor → Recall-style shell → these follow-ups).
