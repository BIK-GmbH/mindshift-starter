# Extension Save Pipeline — How Highlights Reach the Backend

Last updated: 2026-05-11.

This doc explains how the browser extension's "Save" + "Highlight" flow turns a piece of web content into a Mindshift Card, why three rounds of fixes were needed, and how to extend the behaviour to new sites.

If you change anything in the extension's save flow OR in `backend/app/services/article.py`, re-read this first.

## TL;DR

```
Page DOM (rendered, authenticated)
   │
   ├── content/highlight.js
   │     ├── findPostContext(range)         site-specific (LinkedIn, X/Twitter)
   │     ├── findArticleContainer(range)    generic fallback (<article>, role=article, text-density)
   │     └── wrap in <!DOCTYPE html>…<article>…</article>…</html>
   │
   ▼
background.js (service worker)
   │   savePageForUrl → POST /api/cards/from-url { url, page_html, paused }
   │   POST /api/cards/{id}/highlights { anchor_text, prefix, suffix, color, note }
   │
   ▼
Backend services.article.fetch_article(url, html_override=page_html)
   │   if html_override: skip httpx → trafilatura.extract(html_override)
   │   else: httpx.get(url) → trafilatura.extract(response.text)
   │
   ▼
Card with title + text, ready for summarization + embeddings.
```

## Why this is more complicated than "fetch the URL on the server"

Three real-world problems killed the naive `httpx.get(url)` approach. They were each fixed in a separate commit cluster:

### 1. Login walls (LinkedIn / X / NYT / gated Substack)

The user is logged in *in their browser*. The Mindshift server is not. `httpx.get("https://www.linkedin.com/feed/update/…")` from the server gets the login wall, not the post.

**Fix**: extension grabs `document.documentElement.outerHTML` from the user's authenticated tab and POSTs it in `page_html`. Backend's `fetch_article(url, html_override=…)` uses that instead of fetching.

Spec: `docs/superpowers/specs/2026-05-11-extension-page-html-design.md`.

### 2. Feed pages have multiple posts

On LinkedIn / X / Reddit / Facebook, the address bar shows the feed URL (`linkedin.com/feed/`) regardless of which post the user is reading. Sending `documentElement.outerHTML` ships the *entire* feed (3–5 MB, dozens of posts, sidebar, suggested connections). Trafilatura extracts "the feed" as the article content.

**Fix**: in `findPostContext`, walk up from the selection's `range.commonAncestorContainer` looking for a site-specific post wrapper. For LinkedIn, that's any ancestor whose attribute value matches `urn:li:activity:NUMBER`. For X, it's `article[data-testid="tweet"]`. Send only that container's `outerHTML`.

The function also returns a *permalink* — a stable URL for that specific post — so the backend has a unique `source_url` per post, not the shared feed URL. (LinkedIn permalinks have the form `https://www.linkedin.com/feed/update/<urn>/`. X permalinks come from the inner `/status/…` link.)

### 3. Trafilatura needs structure to extract

A bare `<span class="…" data-testid="expandable-text-box">` with the post text inside is too thin for trafilatura. Its extraction heuristic looks for an `<article>`/`<main>`/headings cluster and bails when there isn't one — returns `None` → Card is marked failed with "Could not extract article content".

**Fix**: in `onMouseUp`, before sending, wrap the focused container in a minimal HTML document:

```html
<!DOCTYPE html>
<html>
  <head><title>{document.title}</title></head>
  <body>
    <article>
      {container.outerHTML}
    </article>
  </body>
</html>
```

Now trafilatura sees a well-formed article every time and extracts cleanly.

## File map

### Extension
| File | Responsibility |
|---|---|
| `extension/content/highlight.js` | Selection listener, toolbar, `findPostContext` (site-specific), `findArticleContainer` (generic), HTML wrapping, `chrome.runtime.onMessage` listener for `grabPageHtml` (whole-doc fallback for non-highlight saves) |
| `extension/background.js` | Service worker. `savePageForUrl(url, {tabId, pageHtmlOverride})` — accepts an override from the highlight flow OR calls `grabPageHtml(tabId)` for non-highlight saves. `saveHighlight` handler creates the card via `/from-url` then POSTs to `/cards/{id}/highlights`. |
| `extension/manifest.json` | `content_scripts` registration. Bump the `version` field every time the content script changes so Chrome auto-reloads. |

### Backend
| File | Responsibility |
|---|---|
| `backend/app/schemas/card.py` | `FromUrlRequest.page_html: str \| None`, capped at 5 MB |
| `backend/app/api/cards.py` | `/api/cards/from-url` endpoint forwards `payload.page_html` to the background task |
| `backend/app/services/ingestion.py` | `process_article_card(card_id, job_id, url, *, html_override)` |
| `backend/app/services/article.py` | `fetch_article(url, *, html_override)` — skips `httpx.get` when override is set |

## Container detection priorities

`findPostContext` (site-specific) is tried first. If it returns `null`, `findArticleContainer` (generic) takes over.

### `findPostContext` — site-specific

For LinkedIn (`*.linkedin.com`):
1. Walk up the DOM. For each ancestor, scan **all** attribute values. If any matches `^urn:li:activity:\d+$`, that's the post wrapper. Build permalink `https://www.linkedin.com/feed/update/{urn}/`.
2. If no URN attr found, check each ancestor's `data-id`. If it's a bare numeric activity ID (15–20 digits), wrap into a URN and treat as above.
3. If still nothing, look for a descendant `<a href*="/feed/update/urn:li:activity:..."/>` or `<a href*="/posts/...-activity-..."/>` — extract the URN from the href.

For X/Twitter (`x.com`, `twitter.com`):
- `node.closest('article[data-testid="tweet"]')` → permalink from the inner `/status/…` link.

**Diagnostic dump**: if we're on `linkedin.com` and none of the strategies match, the function emits a `console.warn("[mindshift] LinkedIn post detection FAILED — ancestor chain:", chain)` with the tagName + non-class/style/tabindex attributes of every ancestor up to depth 15. Pasting this log into a fix-request gets the next iteration moving fast.

### `findArticleContainer` — generic

1. CSS selector list (first match wins): `[data-urn^="urn:li:activity:"]`, `article[data-testid="tweet"]`, `[data-testid="tweetText"]`, `shreddit-post`, `[data-testid="post-container"]`, `[data-test-id="post-content"]`.
2. `<article>` ancestor (semantic — Substack, NYT, blogs).
3. `[role="article"]` ancestor (ARIA fallback).
4. First (= smallest) ancestor with 150–20000 chars of text. **Smallest first** matters — the previous version returned the largest in-range ancestor and we ended up shipping the whole feed.
5. Fallback: `node.parentElement`.

Each match logs `console.debug("[mindshift] focused container (priority N, ...):", el)` so you can verify which path was used in DevTools' Verbose level.

## Adding a new site

When a new feed-style site needs special-casing:

1. **Find the post wrapper's stable marker.** Open DevTools, inspect a post, look for attributes that survive page refreshes (data-id, data-urn, data-testid, role). Avoid hashed class names — they change every release.
2. **Find the permalink source.** Either a wrapper attribute or an internal `<a>`. If neither exists, you can only fall back to `location.href` and accept URL-dedup issues across multiple posts on the same page.
3. **Add a branch to `findPostContext`.** Walk up the DOM, match your marker, return `{ container, permalink }`.
4. **Test the diagnostic.** Highlight on the new site, see the console.warn for misses or console.debug for hits. Iterate.
5. **Don't change `findArticleContainer`** unless the site doesn't have any feed-style wrapper at all — that's the generic fallback and changing it affects every site.

Tested-and-working today:
- **LinkedIn** ✅ (URN strategy, three sub-paths)
- **Twitter/X** ⚠️ (code present, never live-tested with the wrap)
- **Reddit** ⚠️ (`shreddit-post` selector present in generic chain, permalink from `findArticleContainer` heuristic — likely works since Reddit post URLs are usually canonical)
- **Substack** ⚠️ (`[data-test-id="post-content"]` in generic chain; standard `<article>` fallback covers most)
- **Generic blogs / Wikipedia / news sites** ✅ — they have `<article>` and the URL is the canonical post URL, no special-casing needed.

## Debug recipe

When a user reports "save failed on site X":

1. Ask them to open DevTools on the page **before** clicking save.
2. Filter the console to "All levels" (default Info+Warning+Error is enough — our `console.warn` is at Warning level).
3. Hit save, then look for:
   - `[mindshift] save: url=… container=… containerChars=… wrappedChars=…` — confirms what we shipped to the backend.
   - `[mindshift] LinkedIn URN attr match: …` (or numeric / permalink-a) — site-specific path matched.
   - `[mindshift] focused container (priority 4, heuristic, …)` — generic heuristic took over.
   - `[mindshift] LinkedIn post detection FAILED — ancestor chain: …` — site-specific path missed; dump shows what DOM actually looks like.
4. Match against the card's `status` + `error_message` in the backend. The combination tells you whether the bug is in the extension (sent wrong HTML) or the backend (extraction failure on what was sent).

## Version-marker convention

`highlight.js` logs `[mindshift] highlight.js vX.Y.Z loaded on <hostname>` at script load. The version is hand-bumped in the source and in `manifest.json` simultaneously. Chrome auto-reloads the extension on manifest version change, but the **page tab** caches the content script — a hard reload (Cmd+Shift+R) is needed to flush. If the version-marker doesn't show in console after a hard reload, the content script is being cached harder than usual and the extension needs to be removed + reloaded from `chrome://extensions`.

## Open follow-ups

- Twitter/X: live-test the existing branch.
- Reddit / Substack: add permalink extraction when those become priority.
- Comments-vs-post disambiguation on Reddit: today highlighting a comment in a thread saves the comment's text as the card, but the URL is the thread URL → all comments on a thread dedup into one card. Solve when needed.
- Notion / Slack public pages: untested. Likely fall back to the heuristic; probably fine.
