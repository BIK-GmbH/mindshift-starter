# Mindshift — Sprint progress

This file is **owned by the AI assistant** to maintain context across
sessions. It captures the active work plan, what's done, and what's next.

When a new session starts, read this first to know where to pick up.

## Active sprint — Recall-pattern follow-ups

Goal: bring the rest of the app up to the Recall-style shell that
`fb2d44c` introduced. Six phases, in order. Each phase ends with a
commit + push and a verified browser test.

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | **Light-mode polish** — tuned the light ink scale for more contrast in mid-tones; theme-aware graph canvas backgrounds (CardGraph, GraphPage). |
| 2 | ✅ | **Graph context sidebar** — Recall-style left sidebar with Search / Filters (source, tag, hide-isolated) / Display (color-by + legend) / Tools (path, timeline) / Stats footer. |
| 3 | ✅ | **Chat conversation history** — backend `chat_sessions` + `chat_messages` tables (migration 0005), CRUD endpoints under `/api/chat/sessions`, persistence wired into both `/api/chat` and `/api/cards/{id}/chat`. ChatPage now has a Recall-style sidebar grouping sessions by day; click loads a conversation, delete removes it. |
| 4 | 🟡 | **Tag manager page** — under settings or as standalone route; list all user tags as a tree, allow rename / move / delete, show card-counts per tag. |
| 5 | ⬜ | **Bulk re-tag** — CLI script (`backend/scripts/retag_existing.py`) that re-runs the OpenAI tagging step on already-completed cards, using the new hierarchical-tag prompt and the user's existing top-level tags as context. |
| 6 | ⬜ | **KB Markdown export** — `/api/export/markdown` endpoint that streams a ZIP of one Markdown file per card, organised in folders matching the tag hierarchy. Frontend trigger in Settings → Account → Export. |

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
