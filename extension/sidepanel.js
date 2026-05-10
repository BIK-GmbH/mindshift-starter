/* Side-panel logic.
 *
 * Lifecycle:
 *   1. Read storage (apiUrl, token, webUrl).
 *      - if missing → show "open settings" pane
 *   2. Read the active tab's URL.
 *   3. Ask the backend if a card already exists for that URL.
 *      - hit  → embed /embed/cards/<id> in an iframe
 *      - miss → show a "Save to Mindshift" CTA
 *   4. Re-detect when the user navigates the active tab.
 */

import { canonicalizeUrl } from "./lib/url.js";

const els = {
  loading: document.getElementById("loadingPane"),
  notConnected: document.getElementById("notConnectedPane"),
  save: document.getElementById("savePane"),
  card: document.getElementById("cardPane"),

  reloadBtn: document.getElementById("reloadBtn"),
  openPopupBtn: document.getElementById("openPopupBtn"),
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  savePageTitle: document.getElementById("savePageTitle"),
  savePageUrl: document.getElementById("savePageUrl"),
  cardFrame: document.getElementById("cardFrame"),
};

let state = { apiUrl: "", token: "", webUrl: "" };
let activeTab = null;

function show(name) {
  for (const el of [els.loading, els.notConnected, els.save, els.card]) {
    el.classList.add("hidden");
  }
  ({
    loading: els.loading,
    notConnected: els.notConnected,
    save: els.save,
    card: els.card,
  })[name]?.classList.remove("hidden");
}

function setStatus(node, msg, kind) {
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

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${state.token}`);
  const res = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
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
  // Canonicalise so a tab on `?utm_source=…` resolves to the same card
  // a clean share-link does. Backend also canonicalises on read, but
  // doing it here saves a round-trip on URLs that are obviously equal.
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
  els.cardFrame.src = `${webBase}/embed/cards/${cardId}`;
  show("card");
}

function showSaveCta(tab) {
  els.savePageTitle.textContent = tab.title || "(untitled page)";
  els.savePageUrl.textContent = tab.url || "";
  setStatus(els.saveStatus, "");
  show("save");
}

/** Read & clear the transient "auto-add this URL on next open" flag the
 *  popup sets when the user clicks "Open side panel". Returns the URL
 *  if the flag is fresh and matches the active tab, else null. */
async function consumeAutoAddIntent(url) {
  try {
    const stored = await chrome.storage.session.get("autoAddOnOpen");
    const intent = stored?.autoAddOnOpen;
    if (!intent) return null;
    // The popup stored a canonicalised URL — compare canon vs canon so
    // tracking-param differences between the popup snapshot and the
    // panel's read of the same tab don't cause a false miss.
    if (intent.url !== canonicalizeUrl(url)) return null;
    // Stale guard — protects against a flag that was set but never
    // consumed because the user closed the popup without confirming.
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

async function autoAddAndEmbed(url) {
  // Show the save pane in "saving…" state while the POST is in flight
  // so the user gets immediate feedback. Backend dedup means a repeat
  // submission of an already-saved URL just returns the existing card.
  showSaveCta({ title: activeTab?.title || "", url });
  els.saveBtn.disabled = true;
  setStatus(els.saveStatus, "Saving…");
  try {
    const data = await call("/api/cards/from-url", {
      method: "POST",
      body: JSON.stringify({ url: canonicalizeUrl(url) }),
    });
    const cardId = data?.card?.id;
    if (cardId) {
      embedCard(cardId);
    } else {
      setStatus(els.saveStatus, "Saved.", "ok");
    }
  } catch (err) {
    setStatus(els.saveStatus, `Failed: ${err.message}`, "err");
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function refresh() {
  show("loading");
  await loadState();
  if (!state.apiUrl || !state.token) {
    show("notConnected");
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
    // Auth errors etc. — fall back to the save CTA so the user can
    // at least try, or open settings to reconnect.
    showSaveCta(activeTab);
    setStatus(els.saveStatus, `Lookup failed: ${err.message}`, "err");
  }
}

async function saveActivePage() {
  if (!activeTab?.url) return;
  els.saveBtn.disabled = true;
  setStatus(els.saveStatus, "Saving…");
  try {
    const data = await call("/api/cards/from-url", {
      method: "POST",
      body: JSON.stringify({ url: canonicalizeUrl(activeTab.url) }),
    });
    const cardId = data?.card?.id;
    if (cardId) {
      embedCard(cardId);
    } else {
      setStatus(els.saveStatus, "Saved.", "ok");
    }
  } catch (err) {
    setStatus(els.saveStatus, `Failed: ${err.message}`, "err");
  } finally {
    els.saveBtn.disabled = false;
  }
}

// React to tab changes — when the user navigates, re-detect.
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only re-run when the page actually finishes loading a new URL.
  if (changeInfo.status === "complete" && tab.active) void refresh();
});

els.reloadBtn.addEventListener("click", () => void refresh());
els.saveBtn.addEventListener("click", () => void saveActivePage());
els.openPopupBtn.addEventListener("click", () => {
  // No programmatic way to open the action popup from the side panel,
  // so we point the user there with a hint.
  setStatus(els.saveStatus, "Click the toolbar icon to open settings.", "err");
});

void refresh();
