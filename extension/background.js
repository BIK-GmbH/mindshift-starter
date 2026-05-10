/* Mindshift extension service worker.
 *
 * The toolbar icon opens the popup (default action). The side panel is
 * a separate UI surface — the popup links into it via the runtime
 * messaging below. We also enable the side panel for every tab so the
 * user can pin it from Chrome's UI without per-page configuration.
 */

import { canonicalizeUrl } from "./lib/url.js";

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

/** Shared save path used by both the popup's `savePage` message and
 *  the `save-current-page` hotkey. Returns the same shape for both
 *  callers so they can show consistent feedback. */
async function savePageForUrl(url) {
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    return { ok: false, error: "Extension not configured", code: "config" };
  }
  const res = await fetch(`${apiUrl}/api/cards/from-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url: canonicalizeUrl(url) }),
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
    const res = await savePageForUrl(url);
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

  // Save the URL the content script is sitting on. The actual fetch
  // runs from the extension origin (host_permissions cover localhost
  // + https://*) so we sidestep the page's own CORS rules. Returns
  // either { ok:true, cardId } or { ok:false, error }.
  if (msg?.type === "savePage") {
    void (async () => {
      try {
        const result = await savePageForUrl(msg.url);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
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
