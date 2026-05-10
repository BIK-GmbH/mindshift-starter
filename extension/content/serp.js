/* SERP overlay — paints a small "📚 Saved" badge next to every Google
 * or DuckDuckGo search result that's already in the user's library.
 *
 * No bundler — runs as a plain content script. The bulk lookup goes
 * through the service worker so we don't need a token on the page
 * itself.
 *
 * Architecture:
 *   1. Detect provider from location.host
 *   2. Pick the right selector for "result title link" on this provider
 *   3. Collect URLs from visible results, send to background
 *   4. For each match, inject a badge inside the title element
 *   5. MutationObserver retriggers steps 3+4 when the page mutates
 *      (Google's infinite scroll, DDG's "load more")
 */

(function () {
  "use strict";

  const PROVIDERS = [
    {
      name: "google",
      hostMatch: /(^|\.)google\.[a-z.]+$/,
      pathMatch: /^\/search/,
      // Google's organic-result title links live inside <h3>s under
      // div#search. The href is on the parent <a>. Selector skips
      // sponsored ads (which sit outside #search) and "People also
      // ask" (which use <h3> inside a different container).
      resultLinks: () =>
        Array.from(
          document.querySelectorAll("div#search a:has(h3)"),
        ).filter((a) => /^https?:/i.test(a.href)),
      // The element to paint the badge inside — we want it next to
      // the title text, not the URL chip.
      titleNodeFor: (anchor) => anchor.querySelector("h3") || anchor,
      observerRoot: () => document.querySelector("div#search") || document.body,
    },
    {
      name: "duckduckgo",
      hostMatch: /(^|\.)duckduckgo\.com$/,
      pathMatch: /^\//,
      // DDG: result title links carry .result__a (classic) or
      // [data-testid="result-title-a"] (current). Cover both.
      resultLinks: () =>
        Array.from(
          document.querySelectorAll(
            'a.result__a, a[data-testid="result-title-a"]',
          ),
        ).filter((a) => /^https?:/i.test(a.href)),
      titleNodeFor: (anchor) => anchor,
      observerRoot: () =>
        document.querySelector(
          '#links, [data-testid="results"], main, body',
        ) || document.body,
    },
  ];

  function getProvider() {
    const host = location.host.toLowerCase();
    const path = location.pathname;
    return PROVIDERS.find((p) => p.hostMatch.test(host) && p.pathMatch.test(path)) || null;
  }

  const provider = getProvider();
  if (!provider) return;

  // Inject style once. Inline keeps everything self-contained — no
  // separate CSS file to register in the manifest.
  const STYLE_ID = "mindshift-serp-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .mindshift-serp-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(16, 185, 129, 0.16);
        color: #047857;
        border: 1px solid rgba(16, 185, 129, 0.4);
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
        vertical-align: middle;
        text-decoration: none;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .mindshift-serp-badge:hover {
        background: rgba(16, 185, 129, 0.26);
        text-decoration: none;
      }
      @media (prefers-color-scheme: dark) {
        .mindshift-serp-badge {
          color: #34d399;
        }
      }
    `;
    document.head?.appendChild(style);
  }

  /** Per-page in-memory cache so MutationObserver re-triggers don't
   *  spam the bulk endpoint. Keys: original URL string. Values:
   *  card UUID or null. */
  const cache = new Map();
  let webOrigin = "";

  // Resolve the web URL once on init so badge clicks land on the
  // right host. Falls back to apiUrl when the popup hasn't
  // discovered a separate web URL yet (same-origin / dev setups).
  chrome.runtime.sendMessage({ type: "getMindshiftOrigins" }, (resp) => {
    if (resp?.ok) {
      webOrigin = resp.webUrl || resp.apiUrl || "";
    }
  });

  /** Build a badge element. Click opens the card in a new tab — we
   *  use an <a target=_blank> rather than a button so middle-click
   *  works and the host page's own click handlers can ignore us. */
  function makeBadge(cardId) {
    const a = document.createElement("a");
    a.className = "mindshift-serp-badge";
    a.title = "Already saved in Mindshift — click to open";
    a.textContent = "📚 Saved";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.href = webOrigin
      ? `${webOrigin}/?card=${cardId}`
      : `https://example.invalid/?card=${cardId}`;
    a.addEventListener("click", (e) => {
      // Stop the host's analytics-style anchor wrappers from also
      // navigating, but don't preventDefault — we *want* the new tab.
      e.stopPropagation();
    });
    return a;
  }

  /** Already-painted? Track with a data attribute on the title node
   *  so we don't double-render when the observer re-runs. */
  const PAINTED_ATTR = "data-mindshift-painted";

  function paint(anchors) {
    for (const anchor of anchors) {
      const title = provider.titleNodeFor(anchor);
      if (!title || title.hasAttribute(PAINTED_ATTR)) continue;
      const url = anchor.href;
      if (!cache.has(url)) continue;
      const cardId = cache.get(url);
      if (!cardId) {
        // Mark as painted-with-no-badge so we don't re-look it up
        // on every mutation.
        title.setAttribute(PAINTED_ATTR, "miss");
        continue;
      }
      title.setAttribute(PAINTED_ATTR, "hit");
      title.appendChild(makeBadge(cardId));
    }
  }

  let inFlight = false;

  async function scan() {
    if (inFlight) return;
    const anchors = provider.resultLinks();
    if (anchors.length === 0) return;
    const newUrls = [];
    for (const a of anchors) {
      if (!cache.has(a.href)) newUrls.push(a.href);
    }
    if (newUrls.length === 0) {
      paint(anchors);
      return;
    }
    inFlight = true;
    try {
      // Backend caps at 50 per request — the SERP rarely shows that
      // many results, but slice defensively.
      const batch = newUrls.slice(0, 50);
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "lookupCardsBulk", urls: batch },
          (r) => resolve(r || { ok: false }),
        );
      });
      if (resp?.ok && resp.results) {
        for (const url of batch) {
          cache.set(url, resp.results[url] ?? null);
        }
      } else {
        // On error, mark as miss so we don't infinite-retry.
        for (const url of batch) cache.set(url, null);
      }
    } finally {
      inFlight = false;
    }
    paint(anchors);
  }

  void scan();

  // Re-scan on page mutations. Debounce so a flurry of DOM changes
  // (Google's "more results" pagination, DDG's load-more) collapses
  // into a single lookup.
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void scan();
    }, 350);
  });

  function startObserver() {
    const root = provider.observerRoot();
    if (!root) {
      // Document hasn't rendered the results container yet — try again.
      setTimeout(startObserver, 500);
      return;
    }
    observer.observe(root, { childList: true, subtree: true });
  }
  startObserver();
})();
