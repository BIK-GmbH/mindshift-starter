/* Highlight overlay — Phase 5 of the Mindshift extension.
 *
 * On the page:
 *   - Listen for mouseup. Non-empty selection → show floating
 *     toolbar near the cursor (Highlight, Highlight + note, Cancel).
 *   - On click: extract anchor + 32-char prefix/suffix, ask the
 *     service worker to (1) ensure a card exists for this URL,
 *     (2) POST the highlight.
 *
 * On page load:
 *   - GET /api/highlights?source_url=<canon> via service worker.
 *   - For each, walk the DOM via TreeWalker, locate prefix+anchor+
 *     suffix in adjacent text nodes, wrap with a styled span.
 *
 * Best-effort restore — highlights that don't match anymore (page
 * was rewritten, navigation cleaned the DOM) are silently skipped.
 */

(function () {
  "use strict";

  // Bail on iframes / non-http schemes / our own pages — running on
  // every iframe would multiply the lookups by N and the toolbar
  // would only confuse the user inside an embed.
  if (window.top !== window.self) return;
  if (!/^https?:$/.test(location.protocol)) return;

  const STYLE_ID = "mindshift-highlight-style";
  const TOOLBAR_ID = "mindshift-highlight-toolbar";
  const HIGHLIGHT_TAG = "mindshift-highlight";

  // Toolbar lifetime: shown while a selection exists, dismissed on
  // outside-click or selection-clear.
  let toolbar = null;
  // Track which anchor strings we've already painted so we don't
  // re-paint them on the next mouseup (double-render visually).
  const painted = new Set();

  // ---------------------------- styles ----------------------------
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      ${HIGHLIGHT_TAG} {
        background: rgba(251, 191, 36, 0.32);
        box-shadow: inset 0 -2px 0 rgba(251, 191, 36, 0.7);
        cursor: help;
        border-radius: 2px;
        padding: 0 1px;
      }
      ${HIGHLIGHT_TAG}[data-color="green"] {
        background: rgba(52, 211, 153, 0.3);
        box-shadow: inset 0 -2px 0 rgba(52, 211, 153, 0.7);
      }
      ${HIGHLIGHT_TAG}[data-color="blue"] {
        background: rgba(125, 211, 252, 0.3);
        box-shadow: inset 0 -2px 0 rgba(125, 211, 252, 0.7);
      }
      ${HIGHLIGHT_TAG}[data-color="pink"] {
        background: rgba(244, 114, 182, 0.3);
        box-shadow: inset 0 -2px 0 rgba(244, 114, 182, 0.7);
      }
      #${TOOLBAR_ID} {
        position: absolute;
        z-index: 2147483640;
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        border-radius: 8px;
        background: #1f2330;
        color: #e6e9f0;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        border: 1px solid #2c3340;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        line-height: 1;
        animation: msHlPop 0.12s ease-out;
      }
      #${TOOLBAR_ID} button {
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        border-radius: 5px;
        padding: 4px 8px;
        cursor: pointer;
        font: inherit;
        font-weight: 500;
        transition: background 0.12s, color 0.12s;
      }
      #${TOOLBAR_ID} button:hover {
        background: rgba(139, 92, 246, 0.2);
        color: #ddd6fe;
      }
      #${TOOLBAR_ID} .ms-hl-icon {
        margin-right: 4px;
      }
      @keyframes msHlPop {
        from { opacity: 0; transform: translateY(4px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  // -------------------------- selection --------------------------
  function activeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 4000) return null;
    return { sel, range, text };
  }

  /** Build a 32-char window of plain text immediately before / after
   *  the selection. Walks across text nodes so the prefix doesn't
   *  cut off in the middle of a word boundary that happens to be
   *  another DOM node. */
  function extractPrefix(range) {
    let cur = range.startContainer;
    let collected = "";
    let offset = range.startOffset;
    while (collected.length < 32 && cur) {
      if (cur.nodeType === Node.TEXT_NODE) {
        const before = cur.textContent.slice(0, offset);
        collected = before + collected;
        if (collected.length >= 32) break;
      }
      // Walk to the previous text node in document order.
      const prev = previousTextNode(cur);
      if (!prev) break;
      cur = prev;
      offset = cur.textContent.length;
    }
    return collected.slice(-32);
  }

  function extractSuffix(range) {
    let cur = range.endContainer;
    let collected = "";
    let offset = range.endOffset;
    while (collected.length < 32 && cur) {
      if (cur.nodeType === Node.TEXT_NODE) {
        const after = cur.textContent.slice(offset);
        collected += after;
        if (collected.length >= 32) break;
      }
      const next = nextTextNode(cur);
      if (!next) break;
      cur = next;
      offset = 0;
    }
    return collected.slice(0, 32);
  }

  function previousTextNode(node) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n) =>
          n.parentElement && n.parentElement.closest(`script, style, ${HIGHLIGHT_TAG}, #${TOOLBAR_ID}`)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    );
    walker.currentNode = node;
    return walker.previousNode();
  }
  function nextTextNode(node) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n) =>
          n.parentElement && n.parentElement.closest(`script, style, ${HIGHLIGHT_TAG}, #${TOOLBAR_ID}`)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    );
    walker.currentNode = node;
    return walker.nextNode();
  }

  /** Site-specific post-detection that finds BOTH the post wrapper
   *  (for grabbing focused HTML) AND a stable permalink URL — used
   *  to fix feed sites where the address bar shows the feed URL but
   *  the user actually highlighted a specific post.
   *
   *  Returns { container, permalink } or null if no site-specific
   *  detection matched. Caller falls back to the generic
   *  `findArticleContainer` + `location.href` when null.
   */
  function findPostContext(range) {
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node) return null;

    // LinkedIn: walk up looking for ANY attribute whose value starts
    // with "urn:li:activity:" (the post URN). LinkedIn renames classes
    // and data-attrs frequently, but the URN value pattern is stable.
    let cur = node;
    while (cur && cur !== document.body) {
      if (cur.attributes) {
        for (const attr of cur.attributes) {
          if (attr.value && attr.value.startsWith("urn:li:activity:")) {
            console.debug(
              "[mindshift] LinkedIn post wrapper found:",
              cur,
              "urn:", attr.value,
            );
            return {
              container: cur,
              permalink: `https://www.linkedin.com/feed/update/${attr.value}/`,
            };
          }
        }
      }
      cur = cur.parentElement;
    }

    // X / Twitter: closest <article data-testid="tweet"> + permalink
    // from the /status/<id>/ link inside it.
    const isTwitter = /(?:^|\.)(x\.com|twitter\.com)$/i.test(location.hostname);
    if (isTwitter) {
      const article =
        node.closest('article[data-testid="tweet"]') || node.closest("article");
      if (article) {
        const a = article.querySelector('a[href*="/status/"]');
        let permalink = null;
        if (a) {
          try {
            permalink = new URL(a.href, location.href).href;
          } catch {
            permalink = null;
          }
        }
        console.debug("[mindshift] Tweet container found:", article, "permalink:", permalink);
        return { container: article, permalink };
      }
    }

    return null;
  }

  /** Find the smallest meaningful container around a selection — used
   *  to send a focused chunk of HTML to the backend instead of the
   *  whole page (which on feed sites like LinkedIn would include every
   *  post, sidebar, suggested connections, etc.).
   *
   *  Priority (first match wins):
   *  1. Feed-site-specific selectors (LinkedIn / X / Reddit).
   *  2. `<article>` ancestor (semantic — Substack, NYT, blogs).
   *  3. `[role="article"]` ancestor (ARIA fallback).
   *  4. First (= smallest) ancestor with 150..20000 chars of text.
   *  5. Fallback: parent element of the selection.
   *
   *  Logs the chosen container via console.debug so the user can verify
   *  in DevTools (filter: "[mindshift]").
   */
  function findArticleContainer(range) {
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node) return null;

    // Priority 1: feed-site selectors. `closest()` walks up the tree.
    const FEED_SELECTORS = [
      '[data-urn^="urn:li:activity:"]',     // LinkedIn post
      '[data-id^="urn:li:activity:"]',      // LinkedIn (legacy attr)
      'article[data-testid="tweet"]',       // X / Twitter
      '[data-testid="tweetText"]',          // X — tweet text container, fallback
      'shreddit-post',                      // Reddit (new layout)
      '[data-testid="post-container"]',     // Reddit (legacy testid)
      '[data-test-id="post-content"]',      // some Substack post pages
    ];
    for (const sel of FEED_SELECTORS) {
      const match = node.closest(sel);
      if (match) {
        console.debug(
          "[mindshift] focused container (priority 1, selector):",
          sel,
          match,
        );
        return match;
      }
    }

    // Priority 2: semantic <article>.
    const article = node.closest("article");
    if (article) {
      console.debug("[mindshift] focused container (priority 2, <article>):", article);
      return article;
    }

    // Priority 3: ARIA role.
    const aria = node.closest('[role="article"]');
    if (aria) {
      console.debug('[mindshift] focused container (priority 3, [role="article"]):', aria);
      return aria;
    }

    // Priority 4: heuristic — FIRST (smallest) ancestor with at least
    // 150 chars of text. The previous version stored "lastGoodCandidate"
    // which ended up being the LARGEST in-range ancestor — exactly the
    // wrong behavior for feed sites.
    let cur = node;
    while (cur && cur !== document.body) {
      const text = (cur.innerText || cur.textContent || "").trim();
      const len = text.length;
      if (len >= 150 && len <= 20000) {
        console.debug(
          "[mindshift] focused container (priority 4, heuristic, len=" + len + "):",
          cur,
        );
        return cur;
      }
      if (len > 20000) break;
      cur = cur.parentElement;
    }

    // Priority 5: fallback.
    const fallback = node.parentElement || node;
    console.debug("[mindshift] focused container (priority 5, fallback):", fallback);
    return fallback;
  }

  // -------------------------- toolbar --------------------------
  function destroyToolbar() {
    toolbar?.remove();
    toolbar = null;
  }

  function showToolbar(rect, onPick) {
    destroyToolbar();
    toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    // Position above the selection; top + page scroll because the
    // toolbar uses absolute positioning relative to <body>.
    const top = window.scrollY + rect.top - 40;
    const left = window.scrollX + rect.left;
    toolbar.style.top = `${Math.max(window.scrollY + 4, top)}px`;
    toolbar.style.left = `${Math.max(4, left)}px`;
    toolbar.innerHTML = `
      <button data-action="save" title="Save highlight">
        <span class="ms-hl-icon">🟡</span>Highlight
      </button>
      <button data-action="save-note" title="Save with note">
        📝 Note
      </button>
    `;
    toolbar.addEventListener("mousedown", (e) => {
      // Don't let clicks on the toolbar dismiss the selection.
      e.preventDefault();
    });
    toolbar.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      onPick(t.dataset.action);
    });
    document.body.appendChild(toolbar);
  }

  // -------------------------- save flow --------------------------
  async function saveHighlight({ text, prefix, suffix, note, color, focusedHtml, url }) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "saveHighlight",
          url: url || location.href,
          title: document.title || "",
          anchor_text: text,
          prefix: prefix || "",
          suffix: suffix || "",
          color: color || "yellow",
          note: note || "",
          focused_html: focusedHtml || null,
        },
        (resp) => resolve(resp || { ok: false }),
      );
    });
  }

  function flash(message, kind = "info") {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 2147483645;
      background: ${kind === "err" ? "#7f1d1d" : "#064e3b"};
      color: ${kind === "err" ? "#fecaca" : "#a7f3d0"};
      border-radius: 8px; padding: 8px 12px;
      font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  // -------------------------- restore --------------------------
  /** Walk the DOM and try to re-locate `anchor_text` between
   *  `prefix` and `suffix` in adjacent text nodes. Returns the
   *  Range to wrap, or null if no match. */
  function locateRange(anchor, prefix, suffix) {
    if (!anchor) return null;
    // Build a flattened text representation by concatenating text
    // nodes (skipping script/style and our own highlights). For each
    // candidate match, walk back to the source text nodes and build
    // a Range that spans the right offsets.
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n) => {
          const p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest(`script, style, ${HIGHLIGHT_TAG}, #${TOOLBAR_ID}`))
            return NodeFilter.FILTER_REJECT;
          return n.nodeValue && n.nodeValue.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      },
    );
    /** Array of [textNode, startOffsetInFlat] entries so we can
     *  translate flat-text offsets back to (node, offset). */
    const segments = [];
    let flat = "";
    let cur = walker.nextNode();
    while (cur) {
      segments.push([cur, flat.length]);
      flat += cur.nodeValue;
      cur = walker.nextNode();
    }
    // Try the most-specific match first: prefix + anchor + suffix.
    const needle = prefix + anchor + suffix;
    let idx = needle.length > 0 ? flat.indexOf(needle) : -1;
    let startInFlat;
    if (idx >= 0) {
      startInFlat = idx + prefix.length;
    } else {
      // Prefix didn't match (page mutated); try just the anchor.
      startInFlat = flat.indexOf(anchor);
      if (startInFlat < 0) return null;
    }
    const endInFlat = startInFlat + anchor.length;

    // Map flat offsets back to (textNode, offsetWithinNode).
    function locate(off) {
      // segments are sorted by their start offset in flat; binary
      // search for the last segment whose start <= off.
      let lo = 0;
      let hi = segments.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segments[mid][1] <= off) lo = mid;
        else hi = mid - 1;
      }
      const [node, base] = segments[lo];
      return { node, offset: off - base };
    }
    const start = locate(startInFlat);
    const end = locate(endInFlat);
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start.node, Math.min(start.offset, start.node.nodeValue.length));
      range.setEnd(end.node, Math.min(end.offset, end.node.nodeValue.length));
      return range;
    } catch {
      return null;
    }
  }

  function paint(range, h) {
    const span = document.createElement(HIGHLIGHT_TAG);
    span.dataset.color = h.color || "yellow";
    span.dataset.id = h.id;
    if (h.note) span.title = h.note;
    try {
      range.surroundContents(span);
    } catch {
      // Range crosses element boundaries — fall back to extractContents
      // and wrap. Some sites' inline tags will mean we wrap multiple
      // children, which can break flow but is better than dropping
      // the highlight.
      try {
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);
      } catch {
        /* give up on this one */
      }
    }
  }

  async function restoreHighlights() {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "fetchHighlightsForUrl", url: location.href },
        (r) => resolve(r || { ok: false, items: [] }),
      );
    });
    if (!resp?.ok || !Array.isArray(resp.items)) return;
    for (const h of resp.items) {
      if (painted.has(h.id)) continue;
      const range = locateRange(h.anchor_text, h.prefix || "", h.suffix || "");
      if (range) {
        paint(range, h);
        painted.add(h.id);
      }
    }
  }

  // -------------------------- wiring --------------------------
  function onMouseUp() {
    // setTimeout 0 lets Chrome finalise the selection state before
    // we read it. Without this the toolbar shows on the *previous*
    // selection on Mac.
    setTimeout(() => {
      const s = activeSelection();
      if (!s) {
        destroyToolbar();
        return;
      }
      const rect = s.range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        destroyToolbar();
        return;
      }
      const prefix = extractPrefix(s.range);
      const suffix = extractSuffix(s.range);
      showToolbar(rect, async (action) => {
        let note = "";
        if (action === "save-note") {
          note = window.prompt("Highlight note:", "") || "";
        }
        destroyToolbar();
        // Site-specific post detection first (LinkedIn, X) — picks up
        // both the right container AND a stable permalink. Falls back
        // to the generic article-container finder + location.href.
        const post = findPostContext(s.range);
        const container = post?.container ?? findArticleContainer(s.range);
        const url = post?.permalink ?? location.href;
        const focusedHtml = container ? container.outerHTML : null;
        // Safety cap — über 5 MB würde der Backend's page_html-Limit gerissen,
        // dann lieber gar nicht schicken und den whole-doc-Fallback ziehen.
        const safeFocusedHtml =
          focusedHtml && focusedHtml.length <= 5_000_000 ? focusedHtml : null;
        const result = await saveHighlight({
          text: s.text,
          prefix,
          suffix,
          note,
          color: "yellow",
          focusedHtml: safeFocusedHtml,
          url,
        });
        if (result?.ok) {
          flash("Highlight saved 🟡", "ok");
          // Optimistically paint the freshly-created range in place.
          if (result.highlight) {
            paint(s.range, result.highlight);
            painted.add(result.highlight.id);
          }
          window.getSelection()?.removeAllRanges();
        } else if (result?.code === "auth") {
          flash("Token expired — reconnect the extension", "err");
        } else if (result?.code === "config") {
          flash("Open the toolbar icon to connect first", "err");
        } else {
          flash(`Save failed: ${result?.error || "unknown error"}`, "err");
        }
      });
    }, 0);
  }

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("selectionchange", () => {
    if (!window.getSelection() || window.getSelection().isCollapsed) {
      destroyToolbar();
    }
  });

  // Initial restore pass — wait for `document_idle` (we're already
  // there) plus a short delay for SPAs that hydrate into the DOM.
  void restoreHighlights();
  setTimeout(() => void restoreHighlights(), 1500);

  // ---------------------- DOM grab (extension save) ----------------------
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
})();
