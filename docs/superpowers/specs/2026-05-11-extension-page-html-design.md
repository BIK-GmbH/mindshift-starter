# Extension-supplied page HTML — Design Spec

**Date:** 2026-05-11
**Status:** User-approved (scope: minimal, no Readability.js, auto-fallback enabled).

---

## 1. Problem

Today the Mindshift extension only sends `{ url }` to `/api/cards/from-url`. The backend then does its own `httpx.get(url)` to fetch the article and runs `trafilatura.extract()` on it. For sites behind a login wall (LinkedIn, X/Twitter, NYT, gated Substack posts) the anonymous server fetch sees the login wall HTML and the resulting card content is "Please sign in to continue" instead of the actual post the user is reading.

The user is logged into these sites in their own browser. The extension runs in that browser context. It already sees the fully-rendered, authenticated DOM. We should ship that DOM to the backend instead of having the backend re-fetch anonymously.

## 2. Goals

- Extension sends `page_html` along with `url` for any save coming from a tab where the content script is running.
- Backend uses `page_html` if provided; falls back to its current `httpx` fetch otherwise (bookmark-saves, retries from the library, etc.).
- No regression for the existing "no extension, paste URL into library" flow.
- No new dependencies.

## 3. Non-goals

- **No Readability.js or DOM-clean-up on the client.** The full outerHTML is good enough — `trafilatura.extract()` does the same boilerplate-removal whether the input came from the extension or the server fetch.
- **No DOM-grab on cross-origin iframes or non-`http(s)` pages.** Content script is only injected on http(s) anyway.
- **No session-cookie forwarding from extension to backend.** That's a different (much scarier) approach.
- **No retry-with-extension-html.** If a user re-ingests a card from the library long after the original save, the server fetches normally; the extension's HTML is a one-shot opportunity at first save.
- **No persistence of `page_html`** in the DB. We extract text from it once during ingestion and discard the HTML.

## 4. Architecture

```
Page (logged-in browser context, e.g., LinkedIn)
└─ content/highlight.js
   └─ chrome.runtime.onMessage listener
      ├─ existing: saveHighlight, etc.
      └─ NEW: { type: "grabPageHtml" } → respond { html: document.documentElement.outerHTML }

Extension Service Worker (background.js)
└─ savePageForUrl(url, { tabId, ... })
   ├─ NEW: grabPageHtml(tabId)  # chrome.tabs.sendMessage → content script
   └─ POST /api/cards/from-url { url, paused, page_html?: string }

Backend
└─ POST /api/cards/from-url (FromUrlRequest now accepts page_html)
   └─ services.ingestion.process_article_card(card_id, job_id, url, html_override=page_html)
      └─ services.article.fetch_article(url, html_override=page_html)
         └─ if html_override: skip httpx, use the provided HTML directly
            else: today's httpx + headers + trafilatura.extract chain
```

## 5. Backend changes

### 5.1 Schema

`backend/app/schemas/card.py`: add a single optional field to `FromUrlRequest`:

```python
class FromUrlRequest(BaseModel):
    url: HttpUrl
    paused: bool = Field(default=False)
    page_html: str | None = Field(
        default=None,
        max_length=5_000_000,  # 5 MB cap — beyond that, fall back to server fetch
        description=(
            "Optional pre-rendered HTML from the user's authenticated browser "
            "(set by the extension). When present, the backend uses this instead "
            "of fetching the URL itself — bypasses login walls."
        ),
    )
```

### 5.2 Endpoint

`backend/app/api/cards.py` (`/api/cards/from-url`): pass `page_html` through to the background task that runs `process_article_card`. Look at the existing call; add `html_override=req.page_html` as a keyword argument.

### 5.3 Service: `process_article_card`

`backend/app/services/ingestion.py`: extend the signature:

```python
def process_article_card(
    card_id: UUID, job_id: UUID, url: str, *, html_override: str | None = None,
) -> None:
    ...
    article = fetch_article(url, html_override=html_override)
    ...
```

### 5.4 Service: `fetch_article`

`backend/app/services/article.py`: skip the `httpx.get()` when `html_override` is set. Use the override directly. `trafilatura.extract()` is called with `html_override` (or fetched HTML) interchangeably.

```python
def fetch_article(url: str, *, html_override: str | None = None) -> ArticleResult | None:
    if html_override:
        html = html_override
        final_url = url
    else:
        try:
            with httpx.Client(...) as client:
                response = client.get(url)
                response.raise_for_status()
                html = response.text
                final_url = str(response.url)
        except (httpx.HTTPError, ValueError):
            return None
    # ... rest identical: trafilatura.extract(html, url=final_url, ...) etc.
```

The image fallback (`_extract_lead_image`) keeps working — it operates on the HTML string regardless of origin.

### 5.5 Tests

Add to `backend/tests/test_article.py` (new file, since none likely exists for the article service):

```python
def test_fetch_article_uses_html_override():
    html = "<html><head><title>Hello</title></head><body><article><p>" + "x" * 500 + "</p></article></body></html>"
    result = fetch_article("https://example.com", html_override=html)
    assert result is not None
    assert result.title == "Hello"
    assert "x" * 100 in result.text


def test_fetch_article_no_network_call_when_override_set(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("httpx.get should not be called when html_override is set")
    monkeypatch.setattr("app.services.article.httpx.Client", boom)
    html = "<html><body><article><p>" + "y" * 500 + "</p></article></body></html>"
    result = fetch_article("https://example.com", html_override=html)
    assert result is not None
```

## 6. Extension changes

### 6.1 Content script message handler

`extension/content/highlight.js` (runs on every http(s) page): add a global message listener that responds to `{ type: "grabPageHtml" }` with the document's outerHTML. Place it next to the existing listeners (the file has none today — this is a new addition).

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "grabPageHtml") {
    try {
      sendResponse({ ok: true, html: document.documentElement.outerHTML });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
    return true;
  }
  return false; // let other listeners (in other scripts) handle their messages
});
```

### 6.2 Service worker grab helper

`extension/background.js`: add `grabPageHtml(tabId)` near the other small helpers (around line 190 where `savePageForUrl` lives). Then call it from `savePageForUrl`.

```js
/** Ask the page's content script for its outerHTML. Returns null when
 *  no content script is running (chrome://, internal pages, the SERP /
 *  YouTube overlays, etc.) — caller should fall back to letting the
 *  backend do its own fetch. */
async function grabPageHtml(tabId) {
  if (typeof tabId !== "number") return null;
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: "grabPageHtml" });
    if (resp?.ok && typeof resp.html === "string" && resp.html.length > 0) {
      // Cap at 5 MB so a particularly heavy page doesn't blow the API.
      // Trafilatura extracts main content regardless, so a truncated tail
      // is usually fine; but if we're already at the cap we'd rather let
      // the backend fetch fresh.
      if (resp.html.length > 5_000_000) return null;
      return resp.html;
    }
  } catch {
    /* content script not loaded — fall back to server fetch */
  }
  return null;
}
```

Wire into `savePageForUrl`:

```js
async function savePageForUrl(url, { tabId, mimeType } = {}) {
  // ... existing token/apiUrl checks ...
  const canon = canonicalizeUrl(url);
  const endpoint = looksLikePdf({ url: canon, mimeType })
    ? "/api/cards/from-pdf-url"
    : "/api/cards/from-url";
  const paused = !!stored.saveAsReadLater;

  const body = { url: canon, paused };
  // Only attach HTML for the from-url path; PDF ingestion is a different flow.
  if (endpoint === "/api/cards/from-url") {
    const html = await grabPageHtml(tabId);
    if (html) body.page_html = html;
  }

  const res = await fetch(`${apiUrl}${endpoint}`, { ... body: JSON.stringify(body) });
  // ... rest unchanged ...
}
```

### 6.3 Manifest version bump

`extension/manifest.json`: bump `"version"` from `"0.8.2"` to `"0.9.0"`. This unlocks the next signed extension build and tells the user the extension changed substantively (Chrome auto-reloads on version change when unpacked).

## 7. Edge cases

- **`chrome://` / `about:` / new tab page** → content script not injected → `grabPageHtml` returns null → server-side fetch (which will also fail, but with the same UX as today: card stays in failed state, retry button visible).
- **SERP pages (Google/DuckDuckGo)** → matched by `content/serp.js` only, NOT `highlight.js`. Our new listener lives in `highlight.js`. **Options**:
  - a) Add the same listener to `serp.js` (consistent across all content scripts).
  - b) Leave SERPs alone — saving a search result URL means saving the *result page*, which is what the server fetch already does best.
  - **Decision: (b).** SERPs are rarely behind login walls and saving them is a niche flow. Don't broaden the scope.
- **YouTube pages** → matched by `youtube.js` only. YouTube `/watch` is handled by `/api/cards/from-youtube` not `/from-url`, so the page-html path doesn't apply. No change needed.
- **Bookmark-save flow** → triggered without a `tabId`, `grabPageHtml(undefined)` returns null → server fetch (today's behaviour). Correct.
- **`page_html` exceeds 5 MB** → extension drops it (returns null), backend falls back to server fetch. Same outcome as if extension didn't supply HTML.
- **`page_html` of empty string** → backend's `if html_override:` is falsy on empty string → falls back to server fetch.
- **Backend retry from library** → no extension context, no `page_html` → server fetch.

## 8. Testing

### Backend
- pytest: `test_fetch_article_uses_html_override` (happy path, parses title + text).
- pytest: `test_fetch_article_no_network_call_when_override_set` (monkey-patch httpx.Client to assert no fetch happens).

### Extension
- Manual: install the unpacked extension, open a LinkedIn post, save via popup or hotkey. Card should contain the actual post text, not the login wall.

### Regression
- Manual: save a public article URL (no login) via the extension. Should work as before.
- Manual: paste a URL into the library "Add → URL" modal (no extension). Should still trigger server fetch.

## 9. Open questions

None at the time of writing.
