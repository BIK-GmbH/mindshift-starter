# Extension — Phase 1: Foundation

Three small, isolated wins that set up clean primitives for everything in
phases 2–5. Each is independently shippable; commit boundary at the end
of each block.

## Block A — URL canonicalisation (blocking for #6, #7, all lookups)

**Goal:** identical URL rendered identically on read and write paths so
"same article, different params" doesn't slip past dedup.

**Strip:** `utm_*`, `gclid`, `fbclid`, `mc_eid`, `mc_cid`, `ref`,
`ref_src`, `ref_url`, `igshid`, `s` (twitter share), `__s`, `_hsenc`,
`_hsmi`, `vero_id`, `vero_conv`, `yclid`, `oly_anon_id`, `oly_enc_id`.

**Normalise YouTube:** any `youtube.com/watch?v=ID&...` and
`youtu.be/ID?...` become `https://www.youtube.com/watch?v=ID`. Drop
fragment unless it's a `t=` timestamp (timestamps stay because they are
semantically meaningful for note bookmarks later in phase 4).

**Normalise general:**
- lowercase scheme + host
- drop default port (`:80` http, `:443` https)
- drop trailing `/` only on root path (`https://x.com` not `https://x.com/`
  → keep root); deeper paths leave trailing `/` as-is to avoid colliding
  with sites that distinguish them
- drop empty fragment

### A1. `extension/lib/url.js` — new file
Pure ES-module `canonicalizeUrl(input: string): string`. No deps on
`chrome.*` so it's testable in Node. Unit tests via a minimal `node:test`
harness in `extension/lib/url.test.js`.

### A2. Wire into extension callsites
- `popup.js` `addCurrentPage` — canon before POST and before display
- `sidepanel.js` `findCardForUrl` and `autoAddAndEmbed` — canon both args
- `sidepanel.js` `consumeAutoAddIntent` — compare canon-on-canon
- `popup.js` sidePanelBtn handler — canon before storing the
  `autoAddOnOpen` flag
- `background.js` both `savePage` and `lookupCardForUrl` handlers — canon
  on the message URL

Imported via dynamic import in service worker (`importScripts` is gone in
MV3); the popup/sidepanel pages get a normal `<script>` tag.

### A3. `backend/app/services/url_normalize.py` — new file
Pure function `canonicalize_url(url: str) -> str` mirroring the JS
version exactly. Same param list, same YouTube rule. Tested in
`backend/tests/test_url_normalize.py`.

### A4. Wire into backend
- `api/cards.py` `from-url` and `from-youtube` and `_create_github_card`:
  canonicalise the incoming `url` before any DB write. The persisted
  `Source.url` should be the canonical form.
- `api/cards.py` `find_card_by_source_url`: canonicalise the `url` query
  param before the SELECT. Without this, old non-canon callers still
  find the right card.
- `Source.canonical_url` already existed for YouTube — keep, but the
  new helper is the source of truth going forward.

### A5. Tests
- JS unit tests in `extension/lib/url.test.js`: 12 cases covering each
  rule + a "leave clean URLs untouched" baseline
- Python unit tests in `backend/tests/test_url_normalize.py`: same 12
  cases — proves JS and Python agree
- Playwright MCP smoke: open the side panel against a YouTube URL with
  tracking params, verify backend got the canonical URL via DB check or
  via re-lookup with bare URL returning the same card

## Block B — Hotkey `Cmd+Shift+M`

**Goal:** save current page without opening the popup.

### B1. `extension/manifest.json`
Add a top-level `"commands"` block:
```json
"commands": {
  "save-current-page": {
    "suggested_key": { "default": "Ctrl+Shift+M", "mac": "Command+Shift+M" },
    "description": "Save the current page to Mindshift"
  }
}
```

### B2. `extension/background.js`
`chrome.commands.onCommand.addListener` for `save-current-page`. Get the
active tab, canonicalise the URL, POST `from-url`, surface result via
`chrome.notifications` (require `notifications` permission). Re-uses the
existing `savePage` message handler internally — extracted into a
`savePageForTab(tabId)` helper so both paths share code.

### B3. Test
Playwright MCP cannot trigger native browser commands directly, so the
manual smoke test is: load the unpacked extension, hit the hotkey on a
test page, observe the notification + DB row.

## Block C — Token-Health-Indicator

**Goal:** user sees expiry before the 401 hits.

### C1. Backend — already exists
`/api/auth/me` returns the decoded JWT claims; `exp` is included. No
backend change needed.

### C2. `extension/popup.js`
After `loadState`, fetch `/api/auth/me`, decode `exp` from the token
itself (avoids needing a custom endpoint). If `exp - now < 7 days`,
render an amber pill in the connected pane: "Token läuft in X Tagen".
If already expired, render a red pill and bounce to settings.

### C3. `extension/popup.html` + `extension/popup.css`
New element `<div id="tokenHealth" class="hidden"></div>` in the
connected pane. Two style classes: `.warn` amber, `.expired` red.

### C4. Test
Playwright MCP: render the popup HTML directly with mocked storage
values — set the token to a JWT with `exp = now + 3 days`, verify the
amber pill is visible.

## Order of execution
1. **Block A** first — URL canon, JS + Python parts together so tests
   pass on both sides, then wire callsites.
2. **Block C** second — pure popup-side work, no overlap with A.
3. **Block B** last — depends on A (canon helper) and B's notification
   surface is the smallest UI affordance, easy to slot in.

## Commit boundaries
- `feat(extension): canonicalize URLs across save & lookup paths`
- `feat(extension): cmd+shift+m hotkey to save current page`
- `feat(extension): show token expiry in popup`

Each commit: tests pass, type-check clean, no linter regressions, full
manual smoke (extension reloaded in Chrome, basic flow works).

## Out of scope for phase 1
- Backend migration to canonicalise existing rows. New writes are clean;
  old rows still resolve via the canonical-on-read query in `A4`.
  Backfill script can come in a later cleanup pass if duplicates surface.
- Settings UI for default hotkey override (Chrome handles that natively
  at `chrome://extensions/shortcuts`).
- Toast styling beyond Chrome's native `chrome.notifications` API.
