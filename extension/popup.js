/* Mindshift extension popup logic.
 *
 * State is stored in `chrome.storage.local`:
 *   apiUrl  – e.g. http://localhost:8001 (no trailing slash)
 *   token   – long-lived JWT minted via /api/auth/extension-token
 */

const els = {
  connected: document.getElementById("connectedPane"),
  settings: document.getElementById("settingsPane"),
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  addBtn: document.getElementById("addPageBtn"),
  importBtn: document.getElementById("importBookmarksBtn"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  status: document.getElementById("status"),
  settingsBtn: document.getElementById("settingsBtn"),
  apiUrl: document.getElementById("apiUrl"),
  apiToken: document.getElementById("apiToken"),
  saveBtn: document.getElementById("saveBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
};

let state = { apiUrl: "", token: "" };
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
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  state.apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  state.token = stored.token || "";
}

async function saveState() {
  await chrome.storage.local.set({ apiUrl: state.apiUrl, token: state.token });
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
    if (!isHttp) setStatus(els.status, "Browser pages can't be saved.", "err");
  } catch (err) {
    setStatus(els.status, String(err), "err");
  }
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
    const data = await call("/api/cards/from-url", {
      method: "POST",
      body: JSON.stringify({ url: activeTab.url }),
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
        chrome.tabs.create({ url: `${state.apiUrl}/cards/${cardId}` });
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
    state = { apiUrl: url, token };
    await saveState();
    setStatus(els.settingsStatus, "Connected.", "ok");
    showPane("connected");
    await refreshActiveTab();
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
  await refreshActiveTab();
  await refreshBookmarkCount();
})();

els.addBtn.addEventListener("click", () => void addCurrentPage());
els.importBtn.addEventListener("click", () => void importAllBookmarks());
els.saveBtn.addEventListener("click", () => void trySave());
els.settingsBtn.addEventListener("click", () => {
  const showing = els.settings.classList.contains("hidden") ? "settings" : "connected";
  showPane(showing);
});
