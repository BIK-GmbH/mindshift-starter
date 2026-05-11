/* Mindshift extension service worker.
 *
 * The toolbar icon opens the popup (default action). The side panel is
 * a separate UI surface — the popup links into it via the runtime
 * messaging below. We also enable the side panel for every tab so the
 * user can pin it from Chrome's UI without per-page configuration.
 */

import { canonicalizeUrl } from "./lib/url.js";
import { shouldRefetch } from "./lib/badge.js";

if (chrome.sidePanel?.setPanelBehavior) {
  // Available in Chrome 116+. Keeps the side panel open across tab
  // switches so the user can compare what they're reading with their
  // saved card.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {
      /* older Chrome — silently ignore */
    });
}

/* ---------------------------- toolbar badge ---------------------------- */

const BADGE_CACHE_KEY = "badgeCache";
const BADGE_GREEN = "#10b981";

/** Read the per-tab badge cache from session storage. Cache shape:
 *  `{ [tabId]: { url, cardId, ts } }`. Session-storage so it clears
 *  when Chrome restarts — we'd rather re-fetch than show stale state
 *  across browser sessions.
 */
async function readBadgeCache() {
  try {
    const stored = await chrome.storage.session.get(BADGE_CACHE_KEY);
    return stored?.[BADGE_CACHE_KEY] || {};
  } catch {
    return {};
  }
}

async function writeBadgeCache(cache) {
  try {
    await chrome.storage.session.set({ [BADGE_CACHE_KEY]: cache });
  } catch {
    /* session storage unavailable in old Chrome — badge becomes
       stateless, lookup runs on every tab event. Acceptable. */
  }
}

/** Look up whether the user has a card for `url` in the same way the
 *  side panel does. Returns the card id or null. Auth/config errors
 *  are squashed to null — badge stays clear when the extension can't
 *  talk to the backend. */
async function lookupCardId(url) {
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) return null;
  try {
    const res = await fetch(
      `${apiUrl}/api/cards/by-source-url?url=${encodeURIComponent(canonicalizeUrl(url))}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function applyBadge(tabId, cardId) {
  if (!chrome.action?.setBadgeText) return;
  try {
    if (cardId) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_GREEN });
      await chrome.action.setBadgeText({ tabId, text: "✓" });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch {
    /* setBadgeText throws if the tab vanished mid-evaluation — ignore. */
  }
}

/** Re-evaluate the badge for a given tab. Idempotent — safe to call
 *  from any of the tab event listeners.
 *
 *  @param {number} tabId
 *  @param {string|undefined} url  raw tab URL (canonicalised here)
 *  @param {{ force?: boolean }} opts  bypass the cache
 */
async function refreshBadgeForTab(tabId, url, opts = {}) {
  if (typeof tabId !== "number") return;
  if (!url || !/^https?:\/\//i.test(url)) {
    await applyBadge(tabId, null);
    return;
  }
  const canon = canonicalizeUrl(url);
  const cache = await readBadgeCache();
  const entry = cache[tabId];
  if (!opts.force && !shouldRefetch(entry, canon, Date.now())) {
    await applyBadge(tabId, entry.cardId);
    return;
  }
  const cardId = await lookupCardId(canon);
  cache[tabId] = { url: canon, cardId, ts: Date.now() };
  await writeBadgeCache(cache);
  await applyBadge(tabId, cardId);
}

if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await refreshBadgeForTab(tabId, tab?.url);
    } catch {
      /* tab gone */
    }
  });
}

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only react to "complete" — `loading` fires 3-5× per nav and
    // would burn ephemeral-port capacity on lookup spam.
    if (changeInfo.status !== "complete") return;
    void refreshBadgeForTab(tabId, tab?.url);
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const cache = await readBadgeCache();
    if (cache[tabId]) {
      delete cache[tabId];
      await writeBadgeCache(cache);
    }
  });
}

/** Optimistically flip the badge to ✓ for a freshly-saved tab AND
 *  notify the page's content script so its in-page button (the
 *  YouTube "Save → Saved" CTA, etc.) updates without a page reload.
 *  Called from every save path — toolbar save, hotkey, side-panel
 *  auto-add — so the user sees one consistent state everywhere. */
async function markTabSaved(tabId, url, cardId) {
  if (typeof tabId !== "number") return;
  const canon = canonicalizeUrl(url);
  const cache = await readBadgeCache();
  cache[tabId] = { url: canon, cardId: cardId || null, ts: Date.now() };
  await writeBadgeCache(cache);
  await applyBadge(tabId, cardId || null);
  // Best-effort fan-out to the tab's content scripts. The receiver may
  // not be there (other-origin frame, no content script for this host),
  // so swallow the "Receiving end does not exist" rejection.
  if (cardId) {
    chrome.tabs
      .sendMessage(tabId, {
        type: "cardSaved",
        url: canon,
        cardId,
      })
      .catch(() => {});
  }
}

/** True when the URL or tab mimeType points at a PDF. Mirrors the
 *  popup's `tabLooksLikePdf` so the routing is consistent across
 *  surfaces (popup button, hotkey, side-panel auto-add). */
function looksLikePdf({ url, mimeType }) {
  if (!url) return false;
  const mt = (mimeType || "").toLowerCase();
  if (mt === "application/pdf" || mt === "application/x-pdf") return true;
  const stripped = url.split("#")[0].split("?")[0].toLowerCase();
  return stripped.endsWith(".pdf");
}

/** Shared save path used by both the popup's `savePage` message and
 *  the `save-current-page` hotkey. Returns the same shape for both
 *  callers so they can show consistent feedback.
 *
 *  When the caller knows which tab the URL belongs to, pass `tabId`
 *  so the badge flips to ✓ immediately. Without it the badge will
 *  catch up on the next tab event (typically <1 s).
 *
 *  PDF tabs route to /from-pdf-url instead of /from-url so the
 *  server fetches the PDF bytes itself; trafilatura on a PDF body
 *  is garbage.
 */
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

async function savePageForUrl(url, { tabId, mimeType, pageHtmlOverride } = {}) {
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
    // Prefer the explicit override (focused container from a highlight
    // save) over the full-document grab. Without override, fall back to
    // grabbing the entire DOM.
    const html = pageHtmlOverride || (await grabPageHtml(tabId));
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

/** Notification helper for the hotkey. We don't want to depend on
 *  chrome.notifications outside this surface, since the popup already
 *  has its own status text. Falls back silently when the API or
 *  permission is unavailable. */
function notify(title, message, kind = "info") {
  if (!chrome.notifications?.create) return;
  const id = `mindshift-${Date.now()}`;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    silent: kind !== "err",
    priority: kind === "err" ? 2 : 0,
  });
}

/** POST a Note card to the backend. Used by the right-click context
 *  menu to capture a quote with a backlink to the source page. */
async function saveSelectionAsNote({ text, sourceUrl, sourceTitle }) {
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    return { ok: false, error: "Extension not configured", code: "config" };
  }
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: false, error: "Empty selection" };

  // Title = first non-empty line of the selection, capped. Falls back
  // to the page title when the selection is multi-paragraph and the
  // first line happens to be a heading-style fragment.
  const firstLine = trimmed.split(/\r?\n/, 1)[0].trim();
  const baseTitle = firstLine || sourceTitle || "Quote";
  const title = baseTitle.slice(0, 200);

  // Body uses a Markdown blockquote with a footer linking to the
  // source. Keeps the page context attached to the note so the user
  // can find their way back even after the card is in the library.
  const quotedBody = trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  const footer = sourceUrl
    ? `\n\n— [${sourceTitle || sourceUrl}](${sourceUrl})`
    : "";
  const body = quotedBody + footer;

  const res = await fetch(`${apiUrl}/api/cards/from-note`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title, body, summarize: false }),
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
  return { ok: true, cardId: data?.card?.id, title: data?.card?.title };
}

const CONTEXT_MENU_ID = "mindshift-save-selection";

/** Idempotent context-menu setup. Runs on install/update AND on every
 *  service-worker spin-up (chrome.runtime.onStartup) — without that,
 *  the menu disappears once Chrome unloads the service worker. */
function ensureContextMenu() {
  if (!chrome.contextMenus?.create) return;
  // remove() before create() so a re-run doesn't throw "duplicate id".
  chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
    // Swallow lastError — the first run has nothing to remove.
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Save selection to Mindshift",
      contexts: ["selection"],
    });
  });
}

if (chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(ensureContextMenu);
}
if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(ensureContextMenu);
}
// Also on cold service-worker bootstrap — covers the case where the
// onInstalled / onStartup events fired before this listener registered.
ensureContextMenu();

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    const sourceUrl = tab?.url && /^https?:\/\//i.test(tab.url)
      ? canonicalizeUrl(tab.url)
      : null;
    const result = await saveSelectionAsNote({
      text: info.selectionText || "",
      sourceUrl,
      sourceTitle: tab?.title || "",
    });
    if (result.ok) {
      const preview = (result.title || info.selectionText || "")
        .replace(/\s+/g, " ")
        .slice(0, 60);
      notify("Saved to Mindshift", `"${preview}…"`, "ok");
    } else if (result.code === "config") {
      notify("Mindshift", "Open the toolbar icon to connect first.", "err");
    } else if (result.code === "auth") {
      notify("Mindshift", "Token expired — reconnect in settings.", "err");
    } else {
      notify("Mindshift", `Save failed: ${result.error}`, "err");
    }
  });
}

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "save-current-page") return;
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
      tab = null;
    }
    const url = tab?.url || "";
    if (!url || !/^https?:\/\//i.test(url)) {
      notify("Mindshift", "Browser pages can't be saved.", "err");
      return;
    }
    const res = await savePageForUrl(url, {
      tabId: tab?.id,
      mimeType: tab?.mimeType,
    });
    if (res.ok) {
      const title = (res.title || tab?.title || url).slice(0, 80);
      notify("Saved to Mindshift", title, "ok");
    } else if (res.code === "config") {
      notify("Mindshift", "Open the toolbar icon to connect first.", "err");
    } else if (res.code === "auth") {
      notify("Mindshift", "Token expired — reconnect in settings.", "err");
    } else {
      notify("Mindshift", `Save failed: ${res.error}`, "err");
    }
  });
}

/** Open the side panel for a specific tab. Called from popup.js via
 *  chrome.runtime.sendMessage so the popup can offer an "Open side
 *  panel" affordance without needing the sidePanel permission itself. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "openSidePanel") {
    const tabId = msg.tabId ?? sender?.tab?.id;
    if (tabId == null || !chrome.sidePanel?.open) {
      sendResponse({ ok: false, error: "Side panel API unavailable" });
      return;
    }
    chrome.sidePanel
      .open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // Side panel uses this to ping the badge cache + content script
  // after it has saved a card directly against the backend (it doesn't
  // route through savePageForUrl, so markTabSaved wouldn't fire on its
  // own). Without this hop the in-page YouTube "Save" button stays in
  // its un-saved state until a page reload.
  if (msg?.type === "notifyCardSaved") {
    const tabId = msg.tabId ?? sender?.tab?.id;
    const url = msg.url || "";
    const cardId = msg.cardId || null;
    if (typeof tabId === "number" && cardId && url) {
      void markTabSaved(tabId, url, cardId);
    }
    sendResponse({ ok: true });
    return true;
  }

  // Save the URL the content script is sitting on. The actual fetch
  // runs from the extension origin (host_permissions cover localhost
  // + https://*) so we sidestep the page's own CORS rules. Returns
  // either { ok:true, cardId } or { ok:false, error }.
  if (msg?.type === "savePage") {
    void (async () => {
      try {
        // sender.tab is set when the message originates from a content
        // script; the popup uses chrome.runtime.sendMessage from an
        // extension page so we need to look up the active tab. Either
        // way the badge gets updated for the right tab.
        let tabId = sender?.tab?.id;
        let mimeType = sender?.tab?.mimeType;
        if (typeof tabId !== "number") {
          try {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (activeTab?.url === msg.url) {
              tabId = activeTab.id;
              mimeType = mimeType || activeTab.mimeType;
            }
          } catch {
            /* keep tabId undefined; badge catches up on next event */
          }
        }
        const result = await savePageForUrl(msg.url, { tabId, mimeType });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // ----------------------------- highlights -----------------------------
  // The page's highlight content script can't talk to the API
  // directly (CORS, missing token). It hands the work to us here:
  // fetch+save flow with auto-save of the parent card if it doesn't
  // exist yet.
  if (msg?.type === "saveHighlight") {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(["apiUrl", "token"]);
        const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
        const token = stored.token || "";
        if (!apiUrl || !token) {
          sendResponse({ ok: false, error: "Extension not configured", code: "config" });
          return;
        }
        // Make sure a card exists for this URL — backend dedup turns
        // a re-save into a no-op so we can do this unconditionally.
        const saveRes = await savePageForUrl(msg.url, {
          tabId: sender?.tab?.id,
          mimeType: sender?.tab?.mimeType,
          pageHtmlOverride: msg.focused_html || null,
        });
        if (!saveRes.ok) {
          sendResponse(saveRes);
          return;
        }
        const cardId = saveRes.cardId;
        if (!cardId) {
          sendResponse({ ok: false, error: "No card id returned" });
          return;
        }
        const res = await fetch(`${apiUrl}/api/cards/${cardId}/highlights`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            anchor_text: msg.anchor_text,
            prefix: msg.prefix || "",
            suffix: msg.suffix || "",
            color: msg.color || "yellow",
            note: msg.note || "",
          }),
        });
        if (res.status === 401 || res.status === 403) {
          sendResponse({ ok: false, error: "Token expired", code: "auth" });
          return;
        }
        if (!res.ok) {
          let detail = res.statusText;
          try {
            const d = await res.json();
            if (typeof d?.detail === "string") detail = d.detail;
          } catch {}
          sendResponse({ ok: false, error: detail });
          return;
        }
        const highlight = await res.json();
        sendResponse({ ok: true, highlight, cardId });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "fetchHighlightsForUrl") {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(["apiUrl", "token"]);
        const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
        const token = stored.token || "";
        if (!apiUrl || !token) {
          sendResponse({ ok: false, items: [] });
          return;
        }
        const canon = canonicalizeUrl(msg.url);
        const res = await fetch(
          `${apiUrl}/api/highlights?source_url=${encodeURIComponent(canon)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          sendResponse({ ok: false, items: [] });
          return;
        }
        const items = await res.json();
        sendResponse({ ok: true, items });
      } catch {
        sendResponse({ ok: false, items: [] });
      }
    })();
    return true;
  }

  // Returns the web app's origin so content scripts can render
  // open-card links pointing at the right host (api ≠ web URL in
  // production deployments). Falls back to apiUrl in same-origin
  // / dev setups.
  if (msg?.type === "getMindshiftOrigins") {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(["apiUrl", "webUrl"]);
        sendResponse({
          ok: true,
          apiUrl: (stored.apiUrl || "").replace(/\/$/, ""),
          webUrl: (stored.webUrl || stored.apiUrl || "").replace(/\/$/, ""),
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // Bulk variant of lookupCardForUrl — used by the SERP-overlay
  // content script to check ten search-result URLs in one round-trip
  // instead of N+1.
  if (msg?.type === "lookupCardsBulk") {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(["apiUrl", "token"]);
        const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
        const token = stored.token || "";
        if (!apiUrl || !token) {
          sendResponse({ ok: false, configured: false });
          return;
        }
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        // Stay under the backend cap and dedup defensively client-side.
        const unique = Array.from(new Set(urls)).slice(0, 50);
        if (unique.length === 0) {
          sendResponse({ ok: true, configured: true, results: {} });
          return;
        }
        const res = await fetch(`${apiUrl}/api/cards/by-source-urls`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ urls: unique }),
        });
        if (!res.ok) {
          sendResponse({
            ok: false,
            configured: true,
            error: `HTTP ${res.status}`,
          });
          return;
        }
        const results = await res.json();
        sendResponse({ ok: true, configured: true, results });
      } catch (err) {
        sendResponse({
          ok: false,
          configured: true,
          error: String(err?.message || err),
        });
      }
    })();
    return true;
  }

  // Same lookup the side panel does — used by content scripts to swap
  // the "Save" button for "Already saved" without reloading.
  if (msg?.type === "lookupCardForUrl") {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(["apiUrl", "token"]);
        const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
        const token = stored.token || "";
        if (!apiUrl || !token) {
          sendResponse({ ok: false, configured: false });
          return;
        }
        const res = await fetch(
          `${apiUrl}/api/cards/by-source-url?url=${encodeURIComponent(canonicalizeUrl(msg.url))}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.status === 404) {
          sendResponse({ ok: true, configured: true, cardId: null });
          return;
        }
        if (!res.ok) {
          sendResponse({ ok: false, configured: true, error: `HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        sendResponse({ ok: true, configured: true, cardId: data?.id });
      } catch (err) {
        sendResponse({ ok: false, configured: true, error: String(err?.message || err) });
      }
    })();
    return true;
  }
});

// ======================================================================
// Voice recording bridge — sidepanel ⇄ background ⇄ offscreen
// ======================================================================
// Why this exists: getUserMedia in a side-panel iframe is rejected by
// Chrome ("Permission dismissed") because the side panel has no UX
// surface for the prompt. The fix is two-staged:
//   1. First-time grant: inject permission.html as an invisible
//      iframe into the active web tab via the content script. That
//      tab has a real omnibox where Chrome anchors the prompt. Once
//      the user clicks Allow, the mic permission is persisted for
//      the extension origin.
//   2. Actual recording: an offscreen document at the extension
//      origin runs MediaRecorder. Audio blob is shipped back through
//      background → sidepanel → embed iframe, which uploads it to
//      /api/transcribe using the user's web-app JWT.
//
// Message flow (origin tags identify the sender so we can route both
// directions through chrome.runtime.sendMessage without confusion):
//   sidepanel  → background : { type: "mindshift:voice:<verb>" }
//   background → offscreen  : { target: "offscreen", type: "<verb>" }
//   offscreen  → background : { origin: "offscreen", ... }
//   permission → background : { origin: "permission", type: "result", ok }
//   background → sidepanel  : { origin: "background", type: "voice:<event>", ... }

let voiceState = "idle"; // idle | requesting | recording | transcribing | error
let pendingStartAfterPermission = false;
let permissionFlowInFlight = false;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    console.warn("[mindshift voice] offscreen already exists");
    return;
  }
  console.warn("[mindshift voice] creating offscreen document");
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Microphone recording for voice-to-text chat input.",
    });
    console.warn("[mindshift voice] offscreen document created");
  } catch (err) {
    console.warn("[mindshift voice] offscreen create FAILED:", err?.message || err);
    throw err;
  }
}

async function closeOffscreenDocumentIfIdle() {
  if (await chrome.offscreen.hasDocument()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      /* already closed */
    }
  }
}

function setVoiceState(state, extra = {}) {
  voiceState = state;
  void chrome.runtime.sendMessage({
    origin: "background",
    type: "voice:state",
    state,
    ...extra,
  });
}

async function startRecording() {
  console.warn("[mindshift voice] startRecording");
  setVoiceState("requesting");
  try {
    await ensureOffscreenDocument();
  } catch (err) {
    setVoiceState("error", {
      message: `Offscreen create failed: ${err?.message || err}`,
    });
    return;
  }
  // Tiny delay so the offscreen listener is attached before we send
  // (createDocument resolves before the doc's JS modules run).
  setTimeout(() => {
    console.warn("[mindshift voice] sending start to offscreen");
    void chrome.runtime
      .sendMessage({ target: "offscreen", type: "start" })
      .catch((err) =>
        console.warn("[mindshift voice] send-to-offscreen failed:", err?.message),
      );
  }, 150);
}

async function stopRecording() {
  if (!(await chrome.offscreen.hasDocument())) return;
  void chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
}

async function cancelRecording() {
  if (await chrome.offscreen.hasDocument()) {
    void chrome.runtime.sendMessage({ target: "offscreen", type: "cancel" });
  }
  setVoiceState("idle");
}

async function startPermissionFlow() {
  console.warn("[mindshift voice] startPermissionFlow");
  if (permissionFlowInFlight) {
    console.warn("[mindshift voice] permission flow already in flight");
    return;
  }
  permissionFlowInFlight = true;
  pendingStartAfterPermission = true;
  setVoiceState("requesting", {
    hint: "permission",
    message: "Bitte erlaube den Mikrofon-Zugriff im aktiven Tab oben.",
  });

  // Find a tab where we can inject the permission iframe — must be
  // http(s) so the content script is loaded there.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const canInject =
    activeTab && /^https?:/i.test(activeTab.url || "") && typeof activeTab.id === "number";
  console.warn(
    "[mindshift voice] active tab:",
    activeTab?.url,
    "canInject:",
    canInject,
  );

  if (canInject) {
    // Make sure the user is actually looking at the tab where the
    // prompt will appear. The side panel keeps focus by default,
    // so if we don't switch they'll miss the omnibox bubble.
    try {
      await chrome.tabs.update(activeTab.id, { active: true });
      if (activeTab.windowId !== undefined) {
        await chrome.windows.update(activeTab.windowId, { focused: true });
      }
    } catch {
      /* ignore */
    }
    await injectPermissionIframe(activeTab.id);
    return;
  }
  {
    // Fall back: try any http(s) tab.
    const anyTab = (await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }))[0];
    if (!anyTab || typeof anyTab.id !== "number") {
      permissionFlowInFlight = false;
      pendingStartAfterPermission = false;
      setVoiceState("error", {
        message:
          "Microphone permission needs a regular browser tab to confirm. Open any website and try again.",
      });
      return;
    }
    console.warn("[mindshift voice] no active http tab — focusing fallback tab", anyTab.id);
    try {
      await chrome.tabs.update(anyTab.id, { active: true });
    } catch {
      /* ignore */
    }
    await injectPermissionIframe(anyTab.id);
    return;
  }
}

async function injectPermissionIframe(tabId) {
  console.warn("[mindshift voice] injectPermissionIframe → tab", tabId);
  // Always use scripting.executeScript — independent of which (if any)
  // content script is registered for the URL. Some pages (YouTube
  // watch URLs) match the dedicated youtube.js content script which
  // synchronously replies undefined to unknown messages, defeating
  // the tabs.sendMessage path silently.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (iframeUrl) => {
        const f = document.createElement("iframe");
        f.style.cssText = "display:none;width:0;height:0;border:0;";
        f.setAttribute("allow", "microphone");
        f.src = iframeUrl;
        const remove = (e) => {
          if (e?.data?.type === "mindshift:permission:done") {
            try {
              f.remove();
            } catch {
              /* already gone */
            }
            window.removeEventListener("message", remove);
          }
        };
        window.addEventListener("message", remove);
        document.body.appendChild(f);
      },
      args: [chrome.runtime.getURL("permission.html")],
    });
    console.warn("[mindshift voice] scripting.executeScript ok");
  } catch (err) {
    console.warn("[mindshift voice] scripting.executeScript failed:", err?.message);
    permissionFlowInFlight = false;
    pendingStartAfterPermission = false;
    setVoiceState("error", {
      message: `Could not show permission prompt: ${err?.message || "unknown"}`,
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  // ---- sidepanel → background (voice control) ----
  if (msg.type === "mindshift:voice:start") {
    void startRecording();
    return;
  }
  if (msg.type === "mindshift:voice:stop") {
    void stopRecording();
    return;
  }
  if (msg.type === "mindshift:voice:cancel") {
    void cancelRecording();
    return;
  }

  // ---- offscreen → background ----
  if (msg.origin === "offscreen") {
    if (msg.type === "state") {
      setVoiceState(msg.state);
      return;
    }
    if (msg.type === "error") {
      setVoiceState("error", { message: `${msg.name}: ${msg.message}` });
      return;
    }
    if (msg.type === "blob") {
      // Forward the audio buffer to the sidepanel so the embed iframe
      // can upload it with the user's JWT.
      void chrome.runtime.sendMessage({
        origin: "background",
        type: "voice:blob",
        buffer: msg.buffer,
        mime: msg.mime,
      });
      setVoiceState("idle");
      // Close the offscreen doc to free resources; will be recreated
      // on next start.
      void closeOffscreenDocumentIfIdle();
      return;
    }
    if (msg.type === "permission-needed") {
      void startPermissionFlow();
      return;
    }
    return;
  }

  // ---- permission iframe → background ----
  if (msg.origin === "permission" && msg.type === "result") {
    permissionFlowInFlight = false;
    if (msg.ok && pendingStartAfterPermission) {
      pendingStartAfterPermission = false;
      void startRecording();
    } else if (!msg.ok) {
      pendingStartAfterPermission = false;
      setVoiceState("error", {
        message: `${msg.name || "Error"}: ${msg.message || "Permission denied."}`,
      });
    }
    return;
  }
});
