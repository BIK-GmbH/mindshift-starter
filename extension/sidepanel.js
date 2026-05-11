/* Side-panel logic.
 *
 * The side panel is the single UI surface for the extension since the
 * toolbar icon now opens it directly (chrome.sidePanel.setPanelBehavior
 * in background.js). The popup has been retired — every power feature
 * it used to host now lives behind the gear icon in this panel:
 *   - API URL + token (Connection)
 *   - Save all tabs (bulk)
 *   - Read Later + auto-save YouTube toggles
 *   - Bookmarks import
 *
 * Lifecycle for the default (card) flow:
 *   1. Read storage (apiUrl, token, webUrl).
 *      - if missing → switch to Settings pane (with connection card open)
 *   2. Read the active tab's URL.
 *   3. Ask the backend if a card already exists for that URL.
 *      - hit  → embed /embed/cards/<id> in an iframe
 *      - miss → show a "Save to Mindshift" CTA
 *   4. Re-detect when the user navigates the active tab.
 */

import { canonicalizeUrl } from "./lib/url.js";
import { applyTranslations, getLocale, initLocale, setLocale, t } from "./lib/i18n.js";

const els = {
  loading: document.getElementById("loadingPane"),
  save: document.getElementById("savePane"),
  card: document.getElementById("cardPane"),
  settings: document.getElementById("settingsPane"),

  reloadBtn: document.getElementById("reloadBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  savePageTitle: document.getElementById("savePageTitle"),
  savePageUrl: document.getElementById("savePageUrl"),
  cardFrame: document.getElementById("cardFrame"),

  // Settings pane refs
  tokenHealth: document.getElementById("tokenHealth"),
  apiUrl: document.getElementById("apiUrl"),
  apiToken: document.getElementById("apiToken"),
  saveBtn2: document.getElementById("saveBtn2"),
  settingsStatus: document.getElementById("settingsStatus"),
  saveAllBtn: document.getElementById("saveAllTabsBtn"),
  cancelSaveAllBtn: document.getElementById("cancelSaveAllBtn"),
  saveAllProgress: document.getElementById("saveAllProgress"),
  readLaterToggle: document.getElementById("readLaterToggle"),
  autoSaveYTToggle: document.getElementById("autoSaveYTToggle"),
  importBtn: document.getElementById("importBookmarksBtn"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  settingsActionStatus: document.getElementById("settingsActionStatus"),
  langBtnDe: document.getElementById("langBtnDe"),
  langBtnEn: document.getElementById("langBtnEn"),
};

let state = { apiUrl: "", token: "", webUrl: "" };
let activeTab = null;
// Remember which pane we were on before the user opened settings so the
// gear button toggles back to the right place.
let lastNonSettingsPane = "loading";

function show(name) {
  for (const el of [els.loading, els.save, els.card, els.settings]) {
    el.classList.add("hidden");
  }
  ({
    loading: els.loading,
    save: els.save,
    card: els.card,
    settings: els.settings,
  })[name]?.classList.remove("hidden");
  if (name !== "settings") lastNonSettingsPane = name;
}

function setStatus(node, msg, kind) {
  if (!node) return;
  node.textContent = msg ?? "";
  node.classList.toggle("ok", kind === "ok");
  node.classList.toggle("err", kind === "err");
}

async function loadState() {
  const stored = await chrome.storage.local.get(["apiUrl", "token", "webUrl"]);
  state.apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  state.token = stored.token || "";
  state.webUrl = (stored.webUrl || "").replace(/\/$/, "");
}

async function saveStateToStorage() {
  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    token: state.token,
    webUrl: state.webUrl,
  });
}

class AuthExpiredError extends Error {
  constructor() {
    super(t("settings.tokenExpiredShort"));
    this.name = "AuthExpiredError";
  }
}

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${state.token}`);
  const res = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    throw new AuthExpiredError();
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function detectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
}

async function findCardForUrl(url) {
  const needle = canonicalizeUrl(url);
  try {
    return await call(`/api/cards/by-source-url?url=${encodeURIComponent(needle)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function embedCard(cardId) {
  const webBase = state.webUrl || state.apiUrl;
  // `sp=1` lets the embed know it's running inside the side panel so
  // it can hide UI that won't work there (e.g. the chat mic button —
  // Chrome blocks getUserMedia in side-panel iframes).
  els.cardFrame.src = `${webBase}/embed/cards/${cardId}?sp=1`;
  show("card");
}

function showSaveCta(tab) {
  els.savePageTitle.textContent = tab.title || t("save.untitled");
  els.savePageUrl.textContent = tab.url || "";
  setStatus(els.saveStatus, "");
  show("save");
}

async function consumeAutoAddIntent(url) {
  try {
    const stored = await chrome.storage.session.get("autoAddOnOpen");
    const intent = stored?.autoAddOnOpen;
    if (!intent) return null;
    if (intent.url !== canonicalizeUrl(url)) return null;
    if (Date.now() - (intent.ts || 0) > 30_000) {
      await chrome.storage.session.remove("autoAddOnOpen");
      return null;
    }
    await chrome.storage.session.remove("autoAddOnOpen");
    return intent.url;
  } catch {
    return null;
  }
}

function tabLooksLikePdf(tab) {
  if (!tab) return false;
  const mime = (tab.mimeType || "").toLowerCase();
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  const u = (tab.url || "").split("#")[0].split("?")[0].toLowerCase();
  return u.endsWith(".pdf");
}

async function autoAddAndEmbed(url) {
  showSaveCta({ title: activeTab?.title || "", url });
  els.saveBtn.disabled = true;
  setStatus(els.saveStatus, t("save.saving"));
  try {
    const endpoint = tabLooksLikePdf(activeTab)
      ? "/api/cards/from-pdf-url"
      : "/api/cards/from-url";
    const stored = await chrome.storage.local.get(["saveAsReadLater"]);
    const paused = !!stored?.saveAsReadLater;
    const data = await call(endpoint, {
      method: "POST",
      body: JSON.stringify({ url: canonicalizeUrl(url), paused }),
    });
    const cardId = data?.card?.id;
    if (cardId) {
      try {
        chrome.runtime.sendMessage({
          type: "notifyCardSaved",
          tabId: activeTab?.id,
          url,
          cardId,
        });
      } catch {
        /* best-effort — embedded card still loads regardless */
      }
      embedCard(cardId);
    } else {
      setStatus(els.saveStatus, t("save.saved"), "ok");
    }
  } catch (err) {
    setStatus(els.saveStatus, t("save.failed", { error: err.message }), "err");
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function refresh() {
  show("loading");
  await loadState();
  if (!state.apiUrl || !state.token) {
    // Skip the legacy notConnectedPane entirely — go straight to the
    // settings pane so the user can paste their token without an
    // extra click.
    openSettings();
    return;
  }
  await detectActiveTab();
  if (!activeTab?.url || !/^https?:\/\//i.test(activeTab.url)) {
    showSaveCta(activeTab ?? { title: "", url: "" });
    return;
  }
  const autoAddUrl = await consumeAutoAddIntent(activeTab.url);
  if (autoAddUrl) {
    void autoAddAndEmbed(autoAddUrl);
    return;
  }
  try {
    const card = await findCardForUrl(activeTab.url);
    if (card?.id) {
      embedCard(card.id);
    } else {
      showSaveCta(activeTab);
    }
  } catch (err) {
    showSaveCta(activeTab);
    setStatus(els.saveStatus, t("save.lookupFailed", { error: err.message }), "err");
  }
}

async function saveActivePage() {
  if (!activeTab?.url) return;
  els.saveBtn.disabled = true;
  setStatus(els.saveStatus, t("save.saving"));
  try {
    const endpoint = tabLooksLikePdf(activeTab)
      ? "/api/cards/from-pdf-url"
      : "/api/cards/from-url";
    const stored = await chrome.storage.local.get(["saveAsReadLater"]);
    const paused = !!stored?.saveAsReadLater;
    const data = await call(endpoint, {
      method: "POST",
      body: JSON.stringify({ url: canonicalizeUrl(activeTab.url), paused }),
    });
    const cardId = data?.card?.id;
    if (cardId) {
      embedCard(cardId);
    } else {
      setStatus(els.saveStatus, t("save.saved"), "ok");
    }
  } catch (err) {
    setStatus(els.saveStatus, t("save.failed", { error: err.message }), "err");
  } finally {
    els.saveBtn.disabled = false;
  }
}

// =====================================================================
// Settings pane — connection, bulk save, toggles, bookmarks
// =====================================================================

function openSettings() {
  show("settings");
  renderTokenHealth();
  els.apiUrl.value = state.apiUrl || "http://localhost:8001";
  els.apiToken.value = state.token || "";
  setStatus(els.settingsStatus, "");
  setStatus(els.settingsActionStatus, "");
  void refreshOpenTabsCount();
  void refreshBookmarkCount();
  void loadReadLaterToggle();
  void loadAutoSaveYTToggle();
}

function toggleSettings() {
  if (els.settings.classList.contains("hidden")) {
    openSettings();
  } else {
    // Close settings → restore the pane we were on before, without
    // re-fetching anything. Re-running refresh() here causes a brief
    // 'loading…' flicker + a full iframe reload, both wasteful since
    // the underlying card/save state hasn't changed.
    show(lastNonSettingsPane || "loading");
    if (lastNonSettingsPane === "loading") void refresh();
  }
}

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

function renderTokenHealth() {
  const node = els.tokenHealth;
  if (!node) return;
  node.classList.add("hidden");
  node.classList.remove("warn", "expired");
  node.textContent = "";
  const exp = decodeJwtExp(state.token);
  if (!exp) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = exp - nowSec;
  if (remaining <= 0) {
    node.classList.remove("hidden");
    node.classList.add("expired");
    node.innerHTML =
      '<span class="token-health-dot"></span><span></span>';
    node.querySelector("span:last-child").textContent = t("settings.tokenExpired");
    return;
  }
  const days = Math.ceil(remaining / 86_400);
  if (days > TOKEN_WARN_DAYS) return;
  node.classList.remove("hidden");
  node.classList.add("warn");
  node.innerHTML = '<span class="token-health-dot"></span><span></span>';
  node.querySelector("span:last-child").textContent = t("settings.tokenExpiresIn", { days });
}

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

async function trySave() {
  const url = els.apiUrl.value.trim().replace(/\/$/, "");
  const token = els.apiToken.value.trim();
  if (!url || !token) {
    setStatus(els.settingsStatus, t("settings.bothRequired"), "err");
    return;
  }
  setStatus(els.settingsStatus, t("settings.testing"));
  try {
    const res = await fetch(`${url}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state = { apiUrl: url, token, webUrl: "" };
    state.webUrl = await discoverWebUrl();
    await saveStateToStorage();
    setStatus(els.settingsStatus, t("settings.connected"), "ok");
    renderTokenHealth();
    await refreshOpenTabsCount();
    await refreshBookmarkCount();
  } catch (err) {
    setStatus(els.settingsStatus, t("settings.couldNotReach", { error: err.message }), "err");
  }
}

// ---------- Bulk save all tabs ----------
let saveAllCancel = false;

async function refreshOpenTabsCount() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    // (t) shadows the imported i18n t() helper inside this closure — use a
    // different identifier so we can keep calling t(key) below.
    const eligible = tabs.filter(
      (tab) => tab.url && /^https?:\/\//i.test(tab.url),
    );
    const n = eligible.length;
    els.saveAllBtn.textContent = n > 0 ? t("openTabs.saveAllN", { n }) : t("openTabs.saveAll");
    els.saveAllBtn.disabled = n < 1 || !state.token;
  } catch {
    els.saveAllBtn.disabled = true;
  }
}

async function saveAllTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ currentWindow: true });
  } catch (err) {
    setStatus(
      els.settingsActionStatus,
      t("openTabs.couldNotRead", { error: err.message }),
      "err",
    );
    return;
  }
  const eligible = tabs.filter((tab) => tab.url && /^https?:\/\//i.test(tab.url));
  if (eligible.length === 0) {
    setStatus(els.settingsActionStatus, t("openTabs.noneSaveable"), "err");
    return;
  }

  saveAllCancel = false;
  els.saveAllBtn.disabled = true;
  els.cancelSaveAllBtn.classList.remove("hidden");
  const stored = await chrome.storage.local.get(["saveAsReadLater"]);
  const paused = !!stored?.saveAsReadLater;
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
      const ep = tabLooksLikePdf(tab) ? "/api/cards/from-pdf-url" : "/api/cards/from-url";
      await call(ep, {
        method: "POST",
        body: JSON.stringify({ url: canonicalizeUrl(tab.url), paused }),
      });
      saved++;
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        setStatus(els.settingsActionStatus, err.message, "err");
        break;
      }
      failed++;
    }
  }
  els.saveAllBtn.disabled = false;
  els.cancelSaveAllBtn.classList.add("hidden");
  els.saveAllProgress.textContent = "";
  let summary = t("openTabs.progress", { saved });
  if (failed) summary += t("openTabs.progressFailed", { failed });
  if (stopped) summary += t("openTabs.progressStopped", { stopped });
  setStatus(els.settingsActionStatus, summary + ".", failed ? "err" : "ok");
}

// ---------- Bookmarks ----------

async function refreshBookmarkCount() {
  try {
    const tree = await chrome.bookmarks.getTree();
    let count = 0;
    const walk = (n) => {
      if (n.url) count++;
      if (n.children) for (const c of n.children) walk(c);
    };
    for (const node of tree) walk(node);
    els.bookmarkCount.textContent = t("bookmarks.count", { n: count });
  } catch {
    els.bookmarkCount.textContent = "";
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

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function importAllBookmarks() {
  els.importBtn.disabled = true;
  setStatus(els.settingsActionStatus, t("bookmarks.reading"));
  try {
    const tree = await chrome.bookmarks.getTree();
    const items = collectBookmarkUrls(tree);
    if (items.length === 0) {
      setStatus(els.settingsActionStatus, t("bookmarks.none"), "err");
      return;
    }
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
      setStatus(els.settingsActionStatus, t("settings.tokenExpiredShort"), "err");
      return;
    }
    if (!res.ok) throw new Error((await res.text()).slice(0, 120));
    const data = await res.json();
    setStatus(
      els.settingsActionStatus,
      t("bookmarks.queued", { n: data.queued }),
      "ok",
    );
  } catch (err) {
    setStatus(els.settingsActionStatus, t("save.failed", { error: err.message }), "err");
  } finally {
    els.importBtn.disabled = false;
  }
}

// ---------- Toggles ----------

const READ_LATER_KEY = "saveAsReadLater";
const AUTO_SAVE_YT_KEY = "autoSaveYouTubeOnEnd";

async function loadReadLaterToggle() {
  try {
    const stored = await chrome.storage.local.get([READ_LATER_KEY]);
    els.readLaterToggle.checked = !!stored?.[READ_LATER_KEY];
  } catch {
    els.readLaterToggle.checked = false;
  }
}

async function loadAutoSaveYTToggle() {
  try {
    const stored = await chrome.storage.local.get([AUTO_SAVE_YT_KEY]);
    els.autoSaveYTToggle.checked = !!stored?.[AUTO_SAVE_YT_KEY];
  } catch {
    els.autoSaveYTToggle.checked = false;
  }
}

// =====================================================================
// Wire-up
// =====================================================================

chrome.tabs.onActivated.addListener(() => {
  // Only re-detect if we're not on the settings pane — tab changes
  // there shouldn't blow away the user's typed-but-unsaved input.
  if (els.settings.classList.contains("hidden")) void refresh();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    if (els.settings.classList.contains("hidden")) void refresh();
  }
});

els.reloadBtn.addEventListener("click", () => void refresh());
els.settingsBtn.addEventListener("click", () => toggleSettings());
els.saveBtn.addEventListener("click", () => void saveActivePage());
els.saveBtn2.addEventListener("click", () => void trySave());
els.saveAllBtn.addEventListener("click", () => void saveAllTabs());
els.cancelSaveAllBtn.addEventListener("click", () => {
  saveAllCancel = true;
});
els.importBtn.addEventListener("click", () => void importAllBookmarks());
els.readLaterToggle.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({
      [READ_LATER_KEY]: els.readLaterToggle.checked,
    });
  } catch (err) {
    setStatus(els.settingsActionStatus, t("toggles.savingFailed", { error: err.message }), "err");
  }
});
els.autoSaveYTToggle.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({
      [AUTO_SAVE_YT_KEY]: els.autoSaveYTToggle.checked,
    });
  } catch (err) {
    setStatus(els.settingsActionStatus, t("toggles.savingFailed", { error: err.message }), "err");
  }
});

// =====================================================================
// Pill bridge: embed iframe → side panel → YouTube tab
// =====================================================================
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "mindshift:seekVideo") return;
  const { videoId, seconds } = data;
  if (typeof videoId !== "string" || typeof seconds !== "number") {
    console.debug("[mindshift sidepanel] bad seekVideo shape, ignoring");
    return;
  }
  const videoIdFromTabUrl = (urlStr) => {
    try {
      const u = new URL(urlStr);
      if (u.hostname === "youtu.be") {
        return u.pathname.slice(1).split("/")[0] || null;
      }
      return u.searchParams.get("v");
    } catch {
      return null;
    }
  };

  void chrome.tabs.query({ url: "*://*.youtube.com/watch*" }, async (tabs) => {
    const matchingTab = (tabs || []).find(
      (tab) => videoIdFromTabUrl(tab.url || "") === videoId,
    );
    if (matchingTab && typeof matchingTab.id === "number") {
      try {
        await chrome.tabs.update(matchingTab.id, { active: true });
        if (matchingTab.windowId !== undefined) {
          await chrome.windows.update(matchingTab.windowId, { focused: true });
        }
      } catch (err) {
        console.warn("[mindshift sidepanel] focus error:", err?.message);
      }
      chrome.tabs
        .sendMessage(matchingTab.id, {
          type: "mindshift:seekVideo",
          videoId,
          seconds,
        })
        .catch((err) =>
          console.warn("[mindshift sidepanel] seek send-error:", err?.message),
        );
      return;
    }
    const url = `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
    try {
      await chrome.tabs.create({ url, active: true });
    } catch (err) {
      console.warn("[mindshift sidepanel] create-tab error:", err?.message);
    }
  });
});

// =====================================================================
// Theme sync: embed iframe drives the side-panel chrome theme too.
// =====================================================================
function applyPanelTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("light", t === "light");
  document.documentElement.classList.toggle("dark", t === "dark");
}

chrome.storage.local.get(["panelTheme"]).then((res) => {
  applyPanelTheme(res?.panelTheme || "dark");
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "mindshift:themeChange") return;
  const theme = data.theme === "light" ? "light" : "dark";
  applyPanelTheme(theme);
  chrome.storage.local.set({ panelTheme: theme }).catch(() => undefined);
});

// =====================================================================
// i18n — initialise locale, hydrate every data-i18n element, wire the
// DE/EN toggle in the settings pane.
// =====================================================================
function renderLangButtonState() {
  const loc = getLocale();
  els.langBtnDe.classList.toggle("is-active", loc === "de");
  els.langBtnEn.classList.toggle("is-active", loc === "en");
}

async function bootI18n() {
  await initLocale();
  applyTranslations();
  renderLangButtonState();
}

els.langBtnDe.addEventListener("click", async () => {
  await setLocale("de");
  renderLangButtonState();
  // Re-render bits the data-i18n attributes don't cover.
  void refreshOpenTabsCount();
  void refreshBookmarkCount();
  renderTokenHealth();
});
els.langBtnEn.addEventListener("click", async () => {
  await setLocale("en");
  renderLangButtonState();
  void refreshOpenTabsCount();
  void refreshBookmarkCount();
  renderTokenHealth();
});

void bootI18n();
void refresh();
