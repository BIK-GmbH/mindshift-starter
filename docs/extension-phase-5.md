# Extension — Phase 5: Heavy lifts

The two biggest items deferred from earlier phases. Both are
self-contained features with their own user-visible surfaces, neither
blocks the other.

## Block P — Read-Later mode

**Goal:** save URLs (or whole tab batches) without burning OpenAI
tokens immediately. The user can decide later which ones to actually
ingest.

### P1. Backend

**Status enum extension** (no migration — `cards.status` is already a
free-form `String(20)`):
- New value: `paused`. Distinct from `queued` because `queued` means
  "background task scheduled, just hasn't started yet" — `paused`
  means "ingestion deliberately deferred, no task scheduled".

**Idempotent save endpoints accept `paused: bool`**:
- `FromUrlRequest`, `FromYouTubeRequest` schemas grow an optional
  `paused: bool = False`.
- `/from-pdf-url` adds the same opt-in.
- When `paused=True`, we create the Card row with `status="paused"`,
  the Source row, and a `Job(status="paused")`, but DO NOT
  `background_tasks.add_task(...)`. Source content stays virgin until
  later.
- Dedup unchanged — same source URL still returns the existing card.

**New trigger endpoint** `POST /api/cards/{card_id}/process`:
- Only acts on cards in `paused` or `failed` status.
- Re-creates a fresh Job, enqueues the appropriate `process_*_card`
  background task, flips card status to `queued`.
- Bulk variant `POST /api/cards/process-paused` runs the trigger for
  every paused card the user owns.

### P2. Frontend (main app)

- `LibraryPage` already filters by `status` query param. Status
  selector in the sidebar / status pill list — add a "Read Later"
  filter that queries `?status=paused`.
- Each paused card gets a "Process now" affordance in the card list.
- Bulk action "Process all paused" in the library header when the
  filter is active.
- `StatusBadge.tsx` learns the `paused` colour (warm grey, distinct
  from the in-flight `queued`/`processing` purple).

### P3. Extension

- Settings toggle in the popup: "Save as Read Later (skip AI for
  now)". Stored in `chrome.storage.local` so the extension stays
  independent of backend prefs.
- When enabled, every `from-url` / `from-pdf-url` / `from-youtube`
  POST sends `paused: true`.
- Side-panel embed renders a "Process now" button in the mini-bar
  when the open card is paused.

### P4. Verification

- Backend unit/smoke: POST with `paused: true` → status="paused",
  no background task scheduled. POST `/{id}/process` → status flips
  to `queued`, task scheduled.
- Frontend: visual check that StatusBadge renders correctly + that
  the filter narrows the list.

## Block Q — Highlight-Overlay (MVP)

**Goal:** select text on any web page, save it as a quote attached to
the card for that page. On revisit, the highlight is restored visually.

This is the recall.ai differentiating feature. I'm shipping an MVP
that handles the common case (immutable articles, clean text) and
admits failure on the hard ones (SPA-rewritten content, infinite-
scroll feeds, mobile touch). Those are explicit phase-6 work.

### Q1. Backend

**Migration `0021_card_highlights`** — new table:
```
card_highlights
  id            uuid pk
  user_id       uuid fk users(id) on delete cascade
  card_id       uuid fk cards(id) on delete cascade
  source_url    text not null              -- canonical URL of the page
  anchor_text   text not null              -- the highlighted string itself
  prefix        text default ''            -- up to 32 chars BEFORE the anchor
  suffix        text default ''            -- up to 32 chars AFTER the anchor
  color         varchar(16) default 'yellow'
  note          text default ''            -- user's optional annotation
  created_at    timestamptz default now()
  updated_at    timestamptz default now()

  index card_highlights_user_url (user_id, source_url)
  index card_highlights_card    (card_id)
```

The prefix/suffix anchors are how we re-locate the highlight on a
later visit when DOM offsets won't survive. Same idea as the W3C
TextFragment proposal but evaluated client-side via Range walk.

**Endpoints** in new file `backend/app/api/highlights.py`:
- `GET /api/cards/{card_id}/highlights` — list for a card
- `POST /api/cards/{card_id}/highlights` — create
- `GET /api/highlights?source_url=...` — list ALL highlights for a
  URL (the content script's read path)
- `PATCH /api/highlights/{id}` — note + color
- `DELETE /api/highlights/{id}`

Pydantic schemas in `backend/app/schemas/highlight.py`. Auth-gated by
`get_current_user`, `card_id` ownership-checked the same way card
endpoints do.

### Q2. Frontend (main app)

**New tab in CardDetailContent**: `highlights`. Renders each highlight
as a card with:
- Coloured left-bar matching `color`
- Quote text
- Prefix/suffix in muted text wrapping the quote (so the user sees
  the surrounding sentence)
- Optional note in italic
- Open-source link with TextFragment fallback
  (`<source_url>#:~:text=<anchor>`) so clicking jumps to the position
  in the original page.

Editor: click a highlight → inline editor for note + colour picker.

`/locales/{de,en}.json`: `card.highlights` tab label + empty state.

### Q3. Extension content script

**`extension/content/highlight.js`** — runs on every http(s) page (no
match restrictions; the user explicitly consented when installing).

On the page:
- Listen for `mouseup` events. If a non-empty selection exists,
  show a small floating toolbar near the selection.
- Toolbar buttons: 🟡 Highlight, 📝 Highlight + note, ✗ Cancel.
- On click: extract `anchor_text` (the selection) plus 32-char
  `prefix` and `suffix` from the surrounding text node(s).
- Send to background via a new `saveHighlight` message.

Background handler `saveHighlight`:
1. Look up (or create + auto-add) the card for the current URL.
2. POST `/api/cards/{card_id}/highlights` with the anchor data.
3. Reply with success/error.

On page load:
- Fetch `GET /api/highlights?source_url=<canonicalised current URL>`.
- For each highlight, walk the DOM via TreeWalker, build a Range
  via `prefix + anchor + suffix` text matching, wrap with a
  `<mindshift-highlight>` styled span.
- Best-effort: highlights that don't match anymore (page was
  rewritten) are silently skipped.

**Inline CSS** injected by the script — yellow background, subtle
border-bottom, hover shows a tooltip with the note.

### Q4. Manifest

- Add `extension/content/highlight.js` to the `content_scripts` list,
  matched against `https://*/*` and `http://*/*`.
- No new permissions needed — `activeTab` already covers the script
  lifecycle.

### Q5. Verification

- Backend: smoke create/list/delete via curl.
- Frontend: open a card, switch to Highlights tab, verify the empty
  state renders.
- Extension: in real Chrome, open an article, select text, hit
  Highlight, confirm card appears in the library with the highlight
  attached. Reload the page, verify the highlight is visually
  restored.

## Ordering

1. **P** first — purely additive, low risk, immediate UX win for
   token-conscious users.
2. **Q** second — bigger surface area; ships the killer feature.

## Commits

- `feat: read-later mode (paused status + process trigger + extension toggle)`
- `feat: highlight overlay (table + endpoints + content script)`
- `chore(extension): bump version 0.7.0 -> 0.8.0`

## Out of scope for phase 5

- Mobile touch selection — desktop-only MVP.
- Overlap conflict resolution — last-wins, no merging.
- Highlights search — no full-text index yet on `anchor_text`.
- SPA-aware re-anchoring — if the host page rewrites the DOM after
  initial paint, our restore pass might miss. We accept that.
