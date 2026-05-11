# Extension-supplied page HTML — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extension sends the rendered DOM along with the URL so the backend can extract content from login-walled pages (LinkedIn, etc.) it can't fetch anonymously.

**Architecture:** Add `page_html: str | None` to `FromUrlRequest`. Backend's `fetch_article(url, html_override=…)` uses the override and skips `httpx.get`. Extension's content script answers `{type:"grabPageHtml"}` messages with `document.documentElement.outerHTML`. Service worker grabs it via `chrome.tabs.sendMessage` before posting to `/api/cards/from-url`. Auto-fallback to server fetch when no HTML is supplied or it exceeds 5 MB.

**Spec reference:** `docs/superpowers/specs/2026-05-11-extension-page-html-design.md`.

**Branch:** `feat/extension-page-html` (already on it).

**Test gate:** Backend pytest + frontend `npx tsc -b --noEmit` for completeness (no frontend code changed but the lint step catches collateral damage if any) + manual extension smoke.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/schemas/card.py` | modify | Add `page_html: str | None` to `FromUrlRequest` |
| `backend/app/api/cards.py` | modify | Pass `page_html` through to background task |
| `backend/app/services/ingestion.py` | modify | `process_article_card` accepts `html_override` |
| `backend/app/services/article.py` | modify | `fetch_article` accepts `html_override`, skips httpx when set |
| `backend/tests/test_article.py` | create | Two tests for the override path |
| `extension/content/highlight.js` | modify | Add message handler for `{type:"grabPageHtml"}` |
| `extension/background.js` | modify | `grabPageHtml(tabId)` helper + integrate in `savePageForUrl` |
| `extension/manifest.json` | modify | Bump version 0.8.2 → 0.9.0 |

---

## Task 1: Backend — schema + endpoint + service + tests

**Files:**
- Modify: `backend/app/schemas/card.py`
- Modify: `backend/app/api/cards.py`
- Modify: `backend/app/services/ingestion.py`
- Modify: `backend/app/services/article.py`
- Create: `backend/tests/test_article.py`

- [ ] **Step 1: Schema**

In `backend/app/schemas/card.py`, find `FromUrlRequest` (around line 79). Update to:

```python
class FromUrlRequest(BaseModel):
    url: HttpUrl
    paused: bool = Field(default=False)
    page_html: str | None = Field(
        default=None,
        max_length=5_000_000,
        description=(
            "Optional pre-rendered HTML from the user's authenticated browser "
            "(set by the extension). When present, the backend uses this instead "
            "of fetching the URL itself — bypasses login walls."
        ),
    )
```

- [ ] **Step 2: `fetch_article` signature + override path**

In `backend/app/services/article.py`, update `fetch_article` (around line 68):

```python
def fetch_article(url: str, *, html_override: str | None = None) -> ArticleResult | None:
    """Fetch and extract main content from a web article. Returns None if no content.

    When `html_override` is supplied (e.g., HTML grabbed by the browser
    extension from a logged-in tab), use it directly and skip the
    anonymous httpx fetch — this is how we bypass login walls on
    LinkedIn / X / NYT / etc.
    """
    if html_override:
        html = html_override
        final_url = url
    else:
        try:
            with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}) as client:
                response = client.get(url)
                response.raise_for_status()
                html = response.text
                final_url = str(response.url)
        except (httpx.HTTPError, ValueError):
            return None

    extracted = trafilatura.extract(
        html,
        url=final_url,
        with_metadata=True,
        include_comments=False,
        favor_recall=True,
        output_format="json",
    )
    if not extracted:
        return None

    import json

    try:
        data = json.loads(extracted)
    except json.JSONDecodeError:
        return None

    text = (data.get("text") or "").strip()
    if not text:
        return None

    image_url = (data.get("image") or "").strip() or None
    if not image_url:
        image_url = _extract_lead_image(html, final_url)

    return ArticleResult(
        title=(data.get("title") or "").strip() or None,
        text=text,
        author=(data.get("author") or "").strip() or None,
        site_name=(data.get("sitename") or "").strip() or None,
        canonical_url=data.get("url") or final_url,
        language=data.get("language"),
        image_url=image_url,
    )
```

(Lift-and-shift of the existing body, wrapped in the `if html_override` branch. The `extracted = …` block onward is unchanged.)

- [ ] **Step 3: `process_article_card` signature**

In `backend/app/services/ingestion.py`, find `process_article_card` (around line 141). Update signature and forward the override:

```python
def process_article_card(
    card_id: UUID,
    job_id: UUID,
    url: str,
    *,
    html_override: str | None = None,
) -> None:
    """Fetch a web article and run the summarization pipeline."""
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        article = fetch_article(url, html_override=html_override)
        if article is None:
            _mark_failed(db, card, job, "Could not extract article content from this URL.")
            return
        # ... rest unchanged
```

- [ ] **Step 4: Endpoint hand-off**

In `backend/app/api/cards.py`, find the `/from-url` endpoint (`create_card_from_url` around line 161). Look at where `process_article_card` is scheduled via `BackgroundTasks` — pass `html_override=req.page_html`:

The exact call site is something like `background_tasks.add_task(process_article_card, card.id, job.id, url)`. Add the kwarg:

```python
background_tasks.add_task(
    process_article_card,
    card.id,
    job.id,
    url,
    html_override=req.page_html,
)
```

If the code path also handles github URLs etc. via a router, only modify the article-card branch.

- [ ] **Step 5: Tests**

Create `backend/tests/test_article.py`:

```python
"""Tests for app.services.article.fetch_article."""
from __future__ import annotations

import pytest

from app.services.article import fetch_article


def test_fetch_article_uses_html_override():
    html = (
        "<html><head><title>Hello World</title></head>"
        "<body><article><p>" + "Lorem ipsum dolor sit amet. " * 30 + "</p></article></body></html>"
    )
    result = fetch_article("https://example.com/post/1", html_override=html)
    assert result is not None
    assert result.title == "Hello World"
    assert "Lorem ipsum" in result.text


def test_fetch_article_no_network_call_when_override_set(monkeypatch):
    """When html_override is supplied, httpx must NOT be called."""
    class Boom:
        def __init__(self, *args, **kwargs):
            raise AssertionError(
                "httpx.Client should not be constructed when html_override is set"
            )
    monkeypatch.setattr("app.services.article.httpx.Client", Boom)
    html = (
        "<html><body><article><p>" + "Stuff. " * 100 + "</p></article></body></html>"
    )
    result = fetch_article("https://example.com/", html_override=html)
    assert result is not None


def test_fetch_article_returns_none_when_no_override_and_bad_url(monkeypatch):
    """Sanity: without override, network errors still produce None as before."""
    import httpx

    class Boom:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def get(self, *args, **kwargs):
            raise httpx.ConnectError("test")
    monkeypatch.setattr("app.services.article.httpx.Client", Boom)
    result = fetch_article("https://example.com/")
    assert result is None
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/backend && .venv/bin/pytest tests/test_article.py -v 2>&1 | tail -15
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add backend/app/schemas/card.py backend/app/api/cards.py backend/app/services/ingestion.py backend/app/services/article.py backend/tests/test_article.py
git commit -m "feat(api): accept extension-supplied page_html on /from-url"
```

---

## Task 2: Extension — content script + service worker

**Files:**
- Modify: `extension/content/highlight.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Content script message handler**

In `extension/content/highlight.js`, add a `chrome.runtime.onMessage.addListener` near the bottom of the file (after the existing IIFE body or at module-top, whichever fits — read the file to find a sensible spot). The listener should answer ONLY `{type: "grabPageHtml"}` and return `false` for everything else so other listeners (in `background.js`) still fire.

```js
// --------------------- DOM grab (extension save) ---------------------
// The service worker calls us when the user saves the current tab. We
// hand over the rendered outerHTML so the backend can extract content
// from login-walled pages it couldn't fetch anonymously.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "grabPageHtml") {
    try {
      sendResponse({ ok: true, html: document.documentElement.outerHTML });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
    return true; // async response — keep the message channel open
  }
  return false;
});
```

Important: the listener should be registered inside the existing IIFE body OR outside it — verify that `chrome.runtime` is accessible. Content scripts have access. If the file has a global wrapper, place the listener inside it.

- [ ] **Step 2: Service worker grab helper**

In `extension/background.js`, add `grabPageHtml(tabId)` near the existing helpers (around line 190 where `savePageForUrl` lives). Put it BEFORE `savePageForUrl` so it's defined when called:

```js
/** Ask the page's content script for its outerHTML. Returns null when
 *  no content script is running (chrome://, internal pages, the SERP
 *  / YouTube overlays, etc.) — caller falls back to letting the backend
 *  do its own fetch. */
async function grabPageHtml(tabId) {
  if (typeof tabId !== "number") return null;
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: "grabPageHtml" });
    if (resp?.ok && typeof resp.html === "string" && resp.html.length > 0) {
      // Cap at 5 MB to match the backend's page_html field limit. Pages
      // larger than that fall back to server-fetch.
      if (resp.html.length > 5_000_000) return null;
      return resp.html;
    }
  } catch {
    /* content script not loaded — fall back to server fetch */
  }
  return null;
}
```

Then wire into `savePageForUrl`. Find the existing body (around lines 193-234) and add the page-html grab before the `fetch()` call:

```js
async function savePageForUrl(url, { tabId, mimeType } = {}) {
  const stored = await chrome.storage.local.get([
    "apiUrl",
    "token",
    "saveAsReadLater",
  ]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    return { ok: false, error: "Extension not configured", code: "config" };
  }
  const canon = canonicalizeUrl(url);
  const endpoint = looksLikePdf({ url: canon, mimeType })
    ? "/api/cards/from-pdf-url"
    : "/api/cards/from-url";
  const paused = !!stored.saveAsReadLater;

  const body = { url: canon, paused };
  // Only attach HTML for the from-url path; PDF ingestion downloads the
  // PDF blob server-side and doesn't benefit from a DOM grab.
  if (endpoint === "/api/cards/from-url") {
    const html = await grabPageHtml(tabId);
    if (html) body.page_html = html;
  }

  const res = await fetch(`${apiUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Token expired", code: "auth" };
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {}
    return { ok: false, error: detail };
  }
  const data = await res.json();
  const cardId = data?.card?.id;
  if (cardId && typeof tabId === "number") {
    await markTabSaved(tabId, canon, cardId);
  }
  return { ok: true, cardId, title: data?.card?.title };
}
```

- [ ] **Step 3: Manifest version bump**

In `extension/manifest.json`, bump:
```json
"version": "0.9.0",
```

(from `"0.8.2"`)

- [ ] **Step 4: Smoke-validate JS (no proper linter wired but ensure files parse)**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
node -e "require('./extension/background.js')" 2>&1 | head -5 || true
```

The above will fail in Node (extension JS uses Chrome APIs) but will reveal SyntaxErrors. Acceptable output: a `chrome is not defined` ReferenceError. NOT acceptable: SyntaxError.

Actually skip this step — Node can't parse extension service workers without polyfills. Visual inspection + manual smoke (Task 3) is the gate. Just verify the files don't have obvious typos by reading them back.

- [ ] **Step 5: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add extension/content/highlight.js extension/background.js extension/manifest.json
git commit -m "feat(extension): send rendered page_html for from-url saves"
```

---

## Task 3: Smoke + ship

**Files:** none.

- [ ] **Step 1: Restart backend**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift && ./scripts/stop.sh && ./scripts/start.sh && sleep 6
```

- [ ] **Step 2: Backend curl smoke**

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"chris@example.com","password":"testpass1234"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

HTML='<html><head><title>Override Smoke</title></head><body><article><p>'$(python3 -c "print('Override worked. ' * 50)")'</p></article></body></html>'

curl -s -X POST http://127.0.0.1:8001/api/cards/from-url \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "import json,sys; print(json.dumps({'url':'https://example.com/smoke-test','page_html':sys.argv[1]}))" "$HTML")" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 201 with a card object. The card's status will be queued/processing initially; check the backend log to confirm the article extraction used the override (no httpx fetch).

- [ ] **Step 3: Verify card content**

```bash
sleep 4  # give the background task time to process
curl -s -X POST http://127.0.0.1:8001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"chris@example.com","password":"testpass1234"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])' > /tmp/token

curl -s "http://127.0.0.1:8001/api/cards?limit=5" \
  -H "Authorization: Bearer $(cat /tmp/token)" \
  | python3 -c "
import sys, json
cards = json.load(sys.stdin)
for c in cards:
    if 'smoke-test' in (c.get('source_url') or ''):
        print('TITLE:', c.get('title'))
        print('STATUS:', c.get('status'))
        print('SUMMARY:', (c.get('concise_summary_md') or '')[:200])
        break
"
```

Expected: TITLE is "Override Smoke", STATUS reaches "completed" (give it ~10s if needed), SUMMARY mentions "Override worked".

- [ ] **Step 4: Hand to user for extension-side smoke**

The autonomous test confirms the backend accepts `page_html` and uses it. The extension-side test (load the unpacked extension in Chrome, navigate to a LinkedIn post, save it, verify the resulting card contains the post text not the login wall) requires a human-driven browser. Report ready for user smoke.

- [ ] **Step 5 (after user confirms): Fast-forward main**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git checkout main && git merge --ff-only feat/extension-page-html
```

---

## Self-review

**Spec coverage:**
- §5.1 schema → Task 1, Step 1 ✓
- §5.2 endpoint → Task 1, Step 4 ✓
- §5.3 process_article_card → Task 1, Step 3 ✓
- §5.4 fetch_article → Task 1, Step 2 ✓
- §5.5 tests → Task 1, Step 5 ✓
- §6.1 content script handler → Task 2, Step 1 ✓
- §6.2 service worker grab + integrate → Task 2, Step 2 ✓
- §6.3 manifest version → Task 2, Step 3 ✓

**Placeholder scan:** no TBDs. Each task has complete code blocks.

**Type consistency:** `html_override` param name used consistently (schema field is `page_html`, function param is `html_override`; the mapping is `html_override=req.page_html` in the endpoint).

---

## Done criteria

- 3 backend tests pass.
- Backend curl smoke shows card created from `page_html`.
- No regression on a plain URL save (Task 3 already exercises this via the existing no-override test).
- Extension files bumped, manifest version 0.9.0, ready to reload in Chrome.
- Branch fast-forwarded to main once user confirms extension smoke.
