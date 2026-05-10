# Extension — Phase 4: Content-Script-Schicht

The extension stops being "an app inside the browser" and starts being
*part of the browsing*. The user surfs, the extension reacts. Four
blocks share the same architecture (content script + background lookup),
so the foundation pays back across all of them.

## Block L — Bulk-Lookup-Endpoint (foundation)

**Goal:** ten-results-in-one-roundtrip. Without this, the SERP overlay
in Block M would do N+1 lookups for every search results page.

### L1. Backend
`POST /api/cards/by-source-urls` in `backend/app/api/cards.py`:
- Body: `{ "urls": ["https://example.com/a", "https://youtube.com/watch?v=..."] }`
- Caps at 50 URLs (defensive — beyond that the caller should rethink).
- Returns: `{ [originalUrl]: cardId | null }` with the **original** URL
  as key (not the canonical), so the caller can map results back to
  the exact strings it sent (DOM hrefs).
- Internally canonicalises each URL, then runs ONE DB query joining
  Card+Source where `Source.url` or `Source.canonical_url` is in the
  combined set of {raw, canon} URLs and `Card.user_id == current_user`.

### L2. Schema
`BySourceUrlsRequest` and `BySourceUrlsResponse` Pydantic models,
mirroring the existing `by-source-url` shape but plural.

### L3. Tests
- Direct `curl` smoke against the dev backend: 5 mixed URLs (some
  saved, some not, some YouTube param variants) → response should
  resolve dedup correctly.
- Cap-test: 100 URLs → 400 error.

## Block O — PDF detection + server-side fetch

**Goal:** when the user is reading a PDF in their browser, "Save this
page" actually saves the PDF, not the trafilatura-misread garbage that
today's article pipeline produces.

### O1. Backend
New `POST /api/cards/from-pdf-url` in `backend/app/api/cards.py`:
- Body: `{ "url": "https://example.com/paper.pdf" }`
- Server fetches the URL with a 25-second timeout, validates the
  content-type is `application/pdf` AND the body length ≤ 25 MiB
  (matching the existing PDF upload cap).
- Reuses `services.storage.get_storage().save()` and
  `services.ingestion.process_pdf_card` — same pipeline as Drag&Drop
  upload, the only difference is where the bytes come from.
- Dedup: same source-URL match as `from-url`. Re-running on a saved
  PDF returns the existing card (Phase 1 dedup).

### O2. Client-side detection
- `extension/popup.js`: if `activeTab.url` ends in `.pdf` (case-
  insensitive) OR `tab.mimeType === "application/pdf"` (Chrome 116+),
  flip the "Add this page" button to "Save this PDF" and route the
  POST to `/api/cards/from-pdf-url`.
- `extension/background.js`: same detection for the hotkey path,
  the side-panel auto-add path, and the save-all-tabs loop.

### O3. Tests
- Direct backend test: POST a known small PDF URL, verify card
  reaches `processing` status and Source.source_type === "pdf".
- Manual: on a `.pdf` tab in dev, click save, confirm pipeline.

## Block M — SERP overlay (Google + DuckDuckGo)

**Goal:** at-a-glance "did I save this already?" badge on every Google
or DuckDuckGo search result that's already in the library.

### M1. Manifest
- New `host_permissions` entries for `https://www.google.com/*`,
  `https://duckduckgo.com/*` (already covered by `https://*/*`,
  but add explicit content-script matches).
- New content script `content/serp.js` matching the same hosts,
  `run_at: document_idle`.

### M2. `extension/content/serp.js`
- Provider detection: `location.host` → `google` / `duckduckgo`.
- Selector map per provider:
  - Google: `div#search a[href^="http"]:has(h3)` — the title-link
    pattern is stable across Google redesigns.
  - DuckDuckGo: `a.result__a[href]` — the classic class.
- Collect URLs from visible results, send to background:
  `chrome.runtime.sendMessage({ type: "lookupCardsBulk", urls: [...] })`.
- For each match, inject a small badge inside the title's `<h3>` /
  `<.result__title>` element: `📚 Saved`. Click → opens the card
  detail in a new tab.
- `MutationObserver` on the main results container so live updates
  (Google's "People also ask", infinite scroll) get re-painted.
- De-dup the lookup against an in-memory `Map<url, cardId|null>`
  per page mount — avoids hammering the bulk endpoint when the
  observer fires on irrelevant DOM mutations.

### M3. `extension/background.js`
New message handler `lookupCardsBulk` that hits the new
`POST /api/cards/by-source-urls` endpoint and forwards the result.

### M4. CSS
Inline `<style>` injected by the content script — keeps the badge
isolated from the host page's stylesheet without needing a separate
CSS file.

### M5. Tests
- Backend bulk-lookup is exercised by Block L's smoke.
- Visual: Playwright MCP navigates to `https://duckduckgo.com/?q=mindshift`
  and verifies that any results matching saved cards get the badge.
  (Google requires more careful interaction to avoid bot detection;
  DuckDuckGo is the clean test surface.)

## Block N — YouTube extension (timestamp + auto-save)

**Goal:** make the YouTube content script earn its keep beyond the
existing inline "Save to Mindshift" button.

### N1. Timestamp-bookmark button
- New button next to the existing save button: "📌 Bei MM:SS speichern".
- Reads current playback time from the `<video>` element on the page.
- If the card already exists for this YouTube URL: PATCH `notes_md`
  with an appended bullet `- [MM:SS](watch?v=...&t=Ns) ` (timestamp
  hyperlink, free-text after the link for the user to fill in later
  via the inline editor).
- If the card doesn't exist: save first with `from-youtube`, then
  immediately PATCH the new card's notes with the timestamp.

### N2. Auto-save-on-watch toggle
- Settings option in the popup: "Auto-save fully-watched YouTube
  videos". Stored in `chrome.storage.local`.
- When enabled, the YouTube content script attaches a listener to
  the `<video>` element's `ended` event. On end, it sends a
  `savePage` message to the background. Backend dedup handles the
  case where the user re-watches the same video.

### N3. Tests
- Manual: open a YouTube watch page, hit the timestamp button at
  ~2 minutes, verify the card's notes_md gets a `[02:00](...)`
  appended.
- Auto-save: enable the toggle, watch a 30 s test video to the end,
  verify a new (or existing dedup) card lands.

## Order of execution

1. **L** first — blocks M (and is needed for any future bulk
   lookup feature like browser-history scan).
2. **O** in parallel-ish — independent, fast win.
3. **M** as the main item.
4. **N** last — extends an existing surface; small risk of YouTube
   DOM changes breaking selectors, easier to fix in isolation.

## Commit boundaries

- `feat(api): bulk by-source-urls lookup endpoint`
- `feat(extension): server-side PDF save when the active tab is a PDF`
- `feat(extension): SERP overlay — badge already-saved results in Google + DDG`
- `feat(extension): YouTube timestamp bookmarks + opt-in auto-save`
- `chore(extension): bump version 0.6.0 -> 0.7.0`

## Out of scope

- Bing, Brave Search SERP support — same selector pattern, can be
  added later without architectural change.
- YouTube live-stream auto-save — `ended` doesn't fire on live
  streams, edge case for v2.
- PDF preview in the side panel — the existing embed view already
  handles PDF cards via the main app's PDF viewer; no special
  side-panel rendering needed.
