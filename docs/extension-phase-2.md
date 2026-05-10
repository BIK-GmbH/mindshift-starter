# Extension — Phase 2: Status signals + bulk capture

Three additions that turn the extension from "single-page saver" into
something the user notices passively while browsing. All build on the
URL-canonicalisation primitive from phase 1.

## Block D — Toolbar badge

**Goal:** at-a-glance "is this page in my library?" without opening
the popup.

### D1. `extension/background.js` — badge state machine

Listeners:
- `chrome.tabs.onActivated` → re-evaluate the badge for the new tab
- `chrome.tabs.onUpdated` → only on `changeInfo.status === "complete"`,
  re-evaluate. The `loading` events fire 3–5× per nav and would burn
  socket pool capacity.
- `chrome.tabs.onRemoved` → drop the tab's cache entry

Cache: `chrome.storage.session` keyed by `tabId` →
`{ url: <canon>, cardId: <uuid|null>, ts: <epoch_ms> }`. Stale rule:
if the tab's current canon-URL ≠ cache.url OR cache is older than
`BADGE_CACHE_MS = 60_000`, re-fetch. Otherwise reuse — the same tab
with the same URL doesn't need a second lookup.

State display:
- card found  → `chrome.action.setBadgeText({ tabId, text: "✓" })`
  + `setBadgeBackgroundColor({ tabId, color: "#10b981" })` (emerald)
- card missing → `setBadgeText({ tabId, text: "" })` (clear)
- not http(s) → clear (avoids badge on `chrome://`, `about:`, files)
- not configured / 401 → clear (no noisy state when extension is
  effectively asleep)

The lookup uses the existing `lookupCardForUrl` message round-trip
(which already canonicalises in phase 1) so we don't duplicate the
fetch logic.

### D2. Trigger badge update after save

When the popup or hotkey saves a card, the badge for the active tab
should flip to ✓ immediately. Add a `chrome.runtime.sendMessage`
broadcast `{ type: "cardSaved", tabId, url }` from `savePageForUrl`,
caught by a listener that re-evaluates the badge. No extra lookup —
we already know the answer.

### D3. Tests

- `extension/lib/badge.test.js` for the cache-staleness rule (pure
  function `shouldRefetch(cacheEntry, currentUrl, nowMs)`).
- Manual smoke: save a page, open a new tab to it, verify ✓ pops up
  within ~1 s of `complete`.
- Playwright MCP smoke: render a page that exposes `chrome.action`
  via a small test shim, verify `setBadgeText` was called with `"✓"`.

## Block E — "Save all tabs"

**Goal:** bulk-save every open tab in the current window with one
click. Backend dedup (already shipped) means re-runs are safe.

### E1. UI — `extension/popup.html` + `popup.css`

Add a third button next to the existing "Add this page" / "Side panel"
row, labeled "Save all tabs (N)". Hide / disable when N < 2.

### E2. Logic — `extension/popup.js`

```
async function saveAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const eligible = tabs.filter(t => /^https?:/i.test(t.url));
  // Sequential, not Promise.all — keeps the backend's BackgroundTask
  // queue from being slammed and gives us per-item progress.
  let saved = 0, dedup = 0, failed = 0;
  for (const t of eligible) {
    const r = await call("/api/cards/from-url",
                         { method: "POST",
                           body: JSON.stringify({ url: canonicalizeUrl(t.url) }) });
    // Backend returns the same shape on dedup as on fresh insert, but
    // jobs created in the same second + same url pattern are a strong
    // dedup signal we can surface in the toast.
    if (r?.card?.created_at !== r?.card?.updated_at) dedup++;
    else saved++;
  }
  setStatus(els.status,
    `Saved ${saved}, deduped ${dedup}, failed ${failed}.`, "ok");
}
```

(Backend doesn't yet distinguish "fresh" vs "dedup hit" cleanly. The
created_at vs updated_at heuristic is good enough for the toast; if
it lies sometimes, the toast is informational only — no UX harm.)

Cancellation: a "Stop" button that flips a `cancelRequested` flag
checked between iterations.

### E3. Tests

- Manual smoke with 5 open tabs: "Save all tabs (5)" → toast shows
  `Saved 5, deduped 0, failed 0`. Re-run → `Saved 0, deduped 5`.
- Playwright MCP unit test for the eligibility filter — the
  `chrome.tabs` mock returns a mix of http(s), chrome://, file:// —
  only http(s) survive.

## Block F — Right-click "Save selection as note"

**Goal:** highlight any text on a page → right-click → save as a Note
card with a backlink to the source URL.

### F1. `extension/manifest.json`

Add `"contextMenus"` to `permissions`.

### F2. `extension/background.js`

```
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-selection-as-note",
    title: "Save selection to Mindshift",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-selection-as-note") return;
  const text = (info.selectionText || "").trim();
  if (!text) return;
  const sourceUrl = tab?.url ? canonicalizeUrl(tab.url) : null;
  const title = (tab?.title || "Quote").slice(0, 200);
  const body = sourceUrl ? `${text}\n\n— ${sourceUrl}` : text;
  // /api/cards/from-note exists — payload: { title, body, summarize }
  // Don't summarise quotes — they're already minimal.
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  …POST /api/cards/from-note with { title, body, summarize: false }…
  notify("Mindshift", `Saved quote: "${text.slice(0, 60)}…"`, "ok");
});
```

### F3. Tests

- Manual smoke: select 100 chars on any page, right-click, choose
  "Save selection to Mindshift", verify a Note card with the source
  URL footer appears in the library.
- Edge case: empty selection → menu item still appears (Chrome
  shows it whenever there's a selection ≥ 1 char), but the listener
  early-returns when trimmed text is empty. Verified by mocking the
  click with `info.selectionText = "   "`.

## Order of execution

1. **F (right-click note)** first — smallest, no shared infrastructure
   change beyond the new permission. Validates the contextMenus path
   that future features (e.g., "save image", "save link") can reuse.
2. **E (save all tabs)** second — pure popup-side work, builds on
   phase 1 dedup so the loop is safe to re-run.
3. **D (toolbar badge)** last — biggest behavioural change, touches
   the global tab event surface. Lands once F and E are stable so a
   regression in badge logic doesn't shadow them.

## Commit boundaries
- `feat(extension): right-click "Save selection to Mindshift"`
- `feat(extension): save-all-tabs bulk button`
- `feat(extension): toolbar badge for already-saved pages`

## Out of scope for phase 2
- SERP overlay (#7) — needs the `by-source-urls` bulk endpoint
  which lands in phase 4.
- Default-target-language preference (#13) — needs a user-prefs
  schema, deferred to phase 3.
- Auto-save-on-watch toggle (#17) — touches the YouTube content
  script, batched with #16 in phase 4.
