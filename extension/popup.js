/* Mindshift extension popup logic.
 *
 * State is stored in `chrome.storage.local`:
 *   apiUrl  – e.g. http://localhost:8001 (no trailing slash)
 *   token   – long-lived JWT minted via /api/auth/extension-token
 */

import { canonicalizeUrl } from "./lib/url.js";

const els = {
  connected: document.getElementById("connectedPane"),
  settings: document.getElementById("settingsPane"),
  tokenHealth: document.getElementById("tokenHealth"),
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  addBtn: document.getElementById("addPageBtn"),
  sidePanelBtn: document.getElementById("openSidePanelBtn"),
  importBtn: document.getElementById("importBookmarksBtn"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  saveAllBtn: document.getElementById("saveAllTabsBtn"),
  cancelSaveAllBtn: document.getElementById("cancelSaveAllBtn"),
  saveAllProgress: document.getElementById("saveAllProgress"),
  autoSaveYTToggle: document.getElementById("autoSaveYTToggle"),
  status: document.getElementById("status"),
  settingsBtn: document.getElementById("settingsBtn"),
  apiUrl: document.getElementById("apiUrl"),
  apiToken: document.getElementById("apiToken"),
  saveBtn: document.getElementById("saveBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
};

let state = { apiUrl: "", token: "", webUrl: "" };
let activeTab = null;

function setStatus(node, msg, kind) {
  node.textContent = msg ?? "";
  node.classList.toggle("ok", kind === "ok");
  node.classList.toggle("err", kind === "err");
}

function showPane(which) {
  els.connected.classList.toggle("hidden", which !== "connected");
  els.settings.classList.toggle("hidden", which !== "settings");
}

async function loadState() {
  const stored = await chrome.storage.local.get(["apiUrl", "token", "webUrl"]);
  state.apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  state.token = stored.token || "";
  state.webUrl = (stored.webUrl || "").replace(/\/$/, "");
}

/** Decode the JWT payload without verifying — we never trust it for
 *  authorization, only to read `exp` for a UX hint. The backend remains
 *  the source of truth on auth and 401s if the token actually fails. */
function decodeJwtExp(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

const TOKEN_WARN_DAYS = 7;

/** Show an amber pill if the token expires within TOKEN_WARN_DAYS, a
 *  red pill if it already expired, hide otherwise. Idempotent — safe
 *  to call after every refresh. */
function renderTokenHealth() {
  const node = els.tokenHealth;
  if (!node) return;
  node.classList.add("hidden");
  node.classList.remove("warn", "expired");
  node.textContent = "";
  const exp = decodeJwtExp(state.token);
  if (!exp) return; // tokens without exp (legacy, opaque) — skip the UX
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = exp - nowSec;
  if (remaining <= 0) {
    node.classList.remove("hidden");
    node.classList.add("expired");
    node.innerHTML =
      '<span class="token-health-dot"></span>' +
      '<span>Token expired — click <strong>Settings</strong> to reconnect.</span>';
    return;
  }
  const days = Math.ceil(remaining / 86_400);
  if (days > TOKEN_WARN_DAYS) return;
  node.classList.remove("hidden");
  node.classList.add("warn");
  const dayLabel = days === 1 ? "day" : "days";
  node.innerHTML =
    '<span class="token-health-dot"></span>' +
    `<span>Token expires in ${days} ${dayLabel} — open <strong>Settings</strong> to refresh.</span>`;
}

async function saveState() {
  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    token: state.token,
    webUrl: state.webUrl,
  });
}

/** Discover the web app URL from the backend so deep-links go to the
 *  right place. Falls back to apiUrl when the endpoint isn't available
 *  (older backend) — matches the local-dev case where API and web are
 *  on the same host but different ports. */
async function discoverWebUrl() {
  try {
    const res = await fetch(`${state.apiUrl}/api/info`);
    if (!res.ok) return state.apiUrl;
    const data = await res.json();
    const url = (data?.web_url || "").replace(/\/$/, "");
    return url || state.apiUrl;
  } catch {
    return state.apiUrl;
  }
}

/** Custom error so callers can branch on auth-expired vs other failures. */
class AuthExpiredError extends Error {
  constructor() {
    super("Your token expired. Reconnect from the settings pane.");
    this.name = "AuthExpiredError";
  }
}

async function call(path, options = {}) {
  if (!state.apiUrl || !state.token) throw new Error("Not configured");
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${state.token}`);
  const res = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    throw new AuthExpiredError();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

/** Show the settings pane with an explanatory message. Used when the API
 *  call returns 401/403 — usually the long-lived token was rotated in
 *  Mindshift's UI and the extension needs a fresh one. */
function bounceToSettings(message) {
  showPane("settings");
  els.apiUrl.value = state.apiUrl || "http://localhost:8001";
  els.apiToken.value = ""; // force user to paste a new one
  setStatus(els.settingsStatus, message, "err");
}

/** True when the active tab is a PDF — either by URL extension or
 *  by the mimeType field Chrome 116+ exposes on `tabs.get()`. The PDF
 *  branch routes through a different backend endpoint that fetches
 *  bytes server-side, because trafilatura on a PDF produces garbage. */
function tabLooksLikePdf(tab) {
  if (!tab) return false;
  const mime = (tab.mimeType || "").toLowerCase();
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  const u = (tab.url || "").split("#")[0].split("?")[0].toLowerCase();
  return u.endsWith(".pdf");
}

async function refreshActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab ?? null;
    if (tab) {
      els.pageTitle.textContent = tab.title || "(untitled)";
      els.pageUrl.textContent = tab.url || "";
    }
    const isHttp = (tab?.url || "").startsWith("http");
    els.addBtn.disabled = !isHttp;
    // Surface the PDF mode in the button label so the user knows we
    // route through a different pipeline. The label persists across
    // popup re-opens because refreshActiveTab runs every time.
    els.addBtn.textContent = tabLooksLikePdf(tab) ? "Save this PDF" : "Add this page";
    if (!isHttp) setStatus(els.status, "Browser pages can't be saved.", "err");
  } catch (err) {
    setStatus(els.status, String(err), "err");
  }
}

async function refreshOpenTabsCount() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const eligible = tabs.filter(
      (t) => t.url && /^https?:\/\//i.test(t.url),
    );
    const n = eligible.length;
    els.saveAllBtn.textContent = n > 0 ? `Save all tabs (${n})` : "Save all tabs";
    els.saveAllBtn.disabled = n < 1;
  } catch {
    els.saveAllBtn.disabled = true;
  }
}

let saveAllCancel = false;

async function saveAllTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ currentWindow: true });
  } catch (err) {
    setStatus(els.status, `Could not read tabs: ${err.message}`, "err");
    return;
  }
  // Drop the about:/chrome:/file: tabs the backend can't ingest.
  const eligible = tabs.filter(
    (t) => t.url && /^https?:\/\//i.test(t.url),
  );
  if (eligible.length === 0) {
    setStatus(els.status, "No saveable tabs in this window.", "err");
    return;
  }

  saveAllCancel = false;
  els.saveAllBtn.disabled = true;
  els.cancelSaveAllBtn.classList.remove("hidden");
  let saved = 0;
  let failed = 0;
  let stopped = 0;
  for (let i = 0; i < eligible.length; i++) {
    if (saveAllCancel) {
      stopped = eligible.length - i;
      break;
    }
    const tab = eligible[i];
    els.saveAllProgress.textContent = `${i + 1}/${eligible.length}`;
    try {
      // Sequential — keeps the backend's BackgroundTask queue from
      // being slammed and gives us per-item progress feedback. Backend
      // dedup makes re-runs idempotent so this is safe to abort and
      // resume later. The dedup hit returns the same shape as a fresh
      // insert so we count both as "saved" — distinguishing the two
      // would need an extra GET per tab.
      const ep = tabLooksLikePdf(tab) ? "/api/cards/from-pdf-url" : "/api/cards/from-url";
      await call(ep, {
        method: "POST",
        body: JSON.stringify({ url: canonicalizeUrl(tab.url) }),
      });
      saved++;
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        bounceToSettings(err.message);
        return;
      }
      failed++;
    }
  }
  els.saveAllBtn.disabled = false;
  els.cancelSaveAllBtn.classList.add("hidden");
  els.saveAllProgress.textContent = "";

  const parts = [`Saved ${saved}`];
  if (failed) parts.push(`failed ${failed}`);
  if (stopped) parts.push(`stopped (${stopped} skipped)`);
  setStatus(els.status, `${parts.join(", ")}.`, failed ? "err" : "ok");
}

async function refreshBookmarkCount() {
  try {
    const tree = await chrome.bookmarks.getTree();
    let count = 0;
    const walk = (n) => {
      if (n.url) count++;
      if (n.children) for (const c of n.children) walk(c);
    };
    for (const node of tree) walk(node);
    els.bookmarkCount.textContent = `${count} link${count === 1 ? "" : "s"}`;
  } catch {
    els.bookmarkCount.textContent = "";
  }
}

async function addCurrentPage() {
  if (!activeTab?.url) return;
  els.addBtn.disabled = true;
  setStatus(els.status, "Saving…");
  try {
    // Backend /api/cards/from-url auto-detects YouTube and GitHub
    // URLs and routes them to the right ingestion pipeline — we don't
    // need to branch by host here.
    const endpoint = tabLooksLikePdf(activeTab)
      ? "/api/cards/from-pdf-url"
      : "/api/cards/from-url";
    const data = await call(endpoint, {
      method: "POST",
      body: JSON.stringify({ url: canonicalizeUrl(activeTab.url) }),
    });
    const cardId = data?.card?.id;
    const title = (data?.card?.title || activeTab.url).slice(0, 60);
    if (cardId) {
      // Render the success toast as a clickable link to the new card.
      // Innerhalb the extension popup we can't open arbitrary tabs
      // synchronously, so we wire chrome.tabs.create on click.
      els.status.classList.add("ok");
      els.status.classList.remove("err");
      els.status.innerHTML = "";
      const span = document.createElement("span");
      span.textContent = `Saved "${title}" — `;
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "open card";
      link.className = "status-link";
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        // webUrl is discovered from /api/info on connect; falls back to
        // apiUrl when the backend hasn't been told about its web URL
        // yet (works in same-origin deployments).
        const webBase = state.webUrl || state.apiUrl;
        chrome.tabs.create({ url: `${webBase}/cards/${cardId}` });
        window.close();
      });
      els.status.append(span, link);
    } else {
      setStatus(els.status, `Saved "${title}".`, "ok");
    }
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      bounceToSettings(err.message);
      return;
    }
    setStatus(els.status, `Failed: ${err.message}`, "err");
  } finally {
    els.addBtn.disabled = false;
  }
}

function collectBookmarkUrls(tree) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (n.url && !seen.has(n.url) && /^https?:\/\//i.test(n.url)) {
      seen.add(n.url);
      out.push({ url: n.url, title: n.title || n.url });
    }
    if (n.children) for (const c of n.children) walk(c);
  };
  for (const node of tree) walk(node);
  return out;
}

async function importAllBookmarks() {
  els.importBtn.disabled = true;
  setStatus(els.status, "Reading bookmarks…");
  try {
    const tree = await chrome.bookmarks.getTree();
    const items = collectBookmarkUrls(tree);
    if (items.length === 0) {
      setStatus(els.status, "No http(s) bookmarks found.", "err");
      return;
    }
    // Build a Netscape-style HTML file in-memory and POST it to
    // /api/import/bookmarks — re-uses the bulk parser the web app
    // already uses, including dedup + 500-cap safety.
    const html = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<TITLE>Bookmarks</TITLE>",
      "<H1>Bookmarks</H1>",
      "<DL><p>",
      ...items.map(
        (it) => `<DT><A HREF="${escapeAttr(it.url)}">${escapeText(it.title)}</A>`,
      ),
      "</DL><p>",
    ].join("\n");

    const form = new FormData();
    form.append("file", new Blob([html], { type: "text/html" }), "bookmarks.html");
    const res = await fetch(`${state.apiUrl}/api/import/bookmarks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      body: form,
    });
    if (res.status === 401 || res.status === 403) {
      bounceToSettings("Your token expired. Reconnect from the settings pane.");
      return;
    }
    if (!res.ok) throw new Error((await res.text()).slice(0, 120));
    const data = await res.json();
    setStatus(
      els.status,
      `Queued ${data.queued} bookmark${data.queued === 1 ? "" : "s"} for ingestion.`,
      "ok",
    );
  } catch (err) {
    setStatus(els.status, `Failed: ${err.message}`, "err");
  } finally {
    els.importBtn.disabled = false;
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function trySave() {
  const url = els.apiUrl.value.trim().replace(/\/$/, "");
  const token = els.apiToken.value.trim();
  if (!url || !token) {
    setStatus(els.settingsStatus, "Both fields are required.", "err");
    return;
  }
  setStatus(els.settingsStatus, "Testing connection…");
  try {
    const res = await fetch(`${url}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state = { apiUrl: url, token, webUrl: "" };
    // Resolve the web app URL from the backend so the "open card" link
    // goes to the right place even when API and web are on different
    // hosts (e.g. Railway: api.example.com vs app.example.com).
    state.webUrl = await discoverWebUrl();
    await saveState();
    setStatus(els.settingsStatus, "Connected.", "ok");
    showPane("connected");
    renderTokenHealth();
    await refreshActiveTab();
    await refreshOpenTabsCount();
    await refreshBookmarkCount();
  } catch (err) {
    setStatus(els.settingsStatus, `Could not reach API: ${err.message}`, "err");
  }
}

(async function init() {
  await loadState();
  if (!state.apiUrl || !state.token) {
    showPane("settings");
    els.apiUrl.value = "http://localhost:8001";
    return;
  }
  els.apiUrl.value = state.apiUrl;
  els.apiToken.value = state.token;
  showPane("connected");
  renderTokenHealth();
  await refreshActiveTab();
  await refreshOpenTabsCount();
  await refreshBookmarkCount();
  // Backfill webUrl for installations from before /api/info existed.
  // Best-effort, no UI feedback — the worst case is the open-card link
  // falls back to apiUrl which is what the old code did anyway.
  if (!state.webUrl) {
    state.webUrl = await discoverWebUrl();
    if (state.webUrl) await saveState();
  }
})();

els.addBtn.addEventListener("click", () => void addCurrentPage());
els.sidePanelBtn?.addEventListener("click", async () => {
  // Ask the service worker to open the side panel for the active tab.
  // The service worker holds the sidePanel permission; popup doesn't
  // need to import it directly.
  const tabId = activeTab?.id;
  if (tabId == null) return;
  // Mark this open as an explicit "save this page" intent so the side
  // panel auto-adds the card on first paint instead of showing the
  // "Save to Mindshift" CTA. Tab-switches with the panel pinned open
  // remain passive (lookup-only) — only this transient flag triggers
  // the auto-add path. Backend dedup makes a re-submission idempotent.
  if (activeTab?.url && /^https?:\/\//i.test(activeTab.url)) {
    try {
      await chrome.storage.session.set({
        autoAddOnOpen: { url: canonicalizeUrl(activeTab.url), ts: Date.now() },
      });
    } catch {
      /* session storage unavailable in old Chrome — fall back to
         normal lookup flow */
    }
  }
  const res = await chrome.runtime.sendMessage({ type: "openSidePanel", tabId });
  if (res?.ok) {
    window.close();
  } else {
    setStatus(els.status, res?.error || "Could not open side panel.", "err");
  }
});
/** YouTube auto-save-on-end toggle. The flag lives in chrome.storage
 *  so the YouTube content script can read it independently of the
 *  popup's lifetime. */
const AUTO_SAVE_YT_KEY = "autoSaveYouTubeOnEnd";

async function loadAutoSaveYT() {
  if (!els.autoSaveYTToggle) return;
  try {
    const stored = await chrome.storage.local.get([AUTO_SAVE_YT_KEY]);
    els.autoSaveYTToggle.checked = !!stored?.[AUTO_SAVE_YT_KEY];
  } catch {
    els.autoSaveYTToggle.checked = false;
  }
}

els.autoSaveYTToggle?.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({
      [AUTO_SAVE_YT_KEY]: els.autoSaveYTToggle.checked,
    });
  } catch (err) {
    setStatus(els.status, `Could not save toggle: ${err.message}`, "err");
  }
});

void loadAutoSaveYT();

els.saveAllBtn?.addEventListener("click", () => void saveAllTabs());
els.cancelSaveAllBtn?.addEventListener("click", () => {
  saveAllCancel = true;
});
els.importBtn.addEventListener("click", () => void importAllBookmarks());
els.saveBtn.addEventListener("click", () => void trySave());
els.settingsBtn.addEventListener("click", () => {
  const showing = els.settings.classList.contains("hidden") ? "settings" : "connected";
  showPane(showing);
});
