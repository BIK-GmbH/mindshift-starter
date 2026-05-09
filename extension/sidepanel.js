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
  try {
    return await call(`/api/cards/by-source-url?url=${encodeURIComponent(url)}`);
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
      body: JSON.stringify({ url: activeTab.url }),
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
