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
import { createVoiceRecorder } from "./lib/voice.js";
import { insertAtCaret } from "./lib/insertAtCaret.js";

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

function embedCard(cardId, card) {
  const webBase = state.webUrl || state.apiUrl;
  els.cardFrame.src = `${webBase}/embed/cards/${cardId}`;
  show("card");
  // Mount the side-panel chat for this card. We pass the full card
  // object when we have it (resolves the title for the chat header);
  // when only the id is known (post-save flow), pass a minimal stub
  // and let mountChat keep its default "Chat" title.
  globalThis.chatOnCardResolved?.(card || { id: cardId });
}

function showSaveCta(tab) {
  els.savePageTitle.textContent = tab.title || "(untitled page)";
  els.savePageUrl.textContent = tab.url || "";
  setStatus(els.saveStatus, "");
  show("save");
  globalThis.chatOnCardResolved?.(null);
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

function tabLooksLikePdf(tab) {
  if (!tab) return false;
  const mime = (tab.mimeType || "").toLowerCase();
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  const u = (tab.url || "").split("#")[0].split("?")[0].toLowerCase();
  return u.endsWith(".pdf");
}

async function autoAddAndEmbed(url) {
  // Show the save pane in "saving…" state while the POST is in flight
  // so the user gets immediate feedback. Backend dedup means a repeat
  // submission of an already-saved URL just returns the existing card.
  showSaveCta({ title: activeTab?.title || "", url });
  els.saveBtn.disabled = true;
  setStatus(els.saveStatus, "Saving…");
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
      // Let the background sync the toolbar badge + notify the
      // content script on the current tab so its in-page "Save" CTA
      // (the YouTube button etc.) flips to "Saved" without a reload.
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
      embedCard(card.id, card);
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

// ============================================================
// Chat module (Phase: side-panel chat)
// ============================================================

const chatState = {
  cardId: null,
  sessionId: null,
  messages: [],
  pending: false,
  voice: null,
};

const $chat = {
  pane: () => document.getElementById("chat-pane"),
  title: () => document.getElementById("chat-title"),
  messages: () => document.getElementById("chat-messages"),
  form: () => document.getElementById("chat-form"),
  input: () => document.getElementById("chat-input"),
  voice: () => document.getElementById("chat-voice"),
  send: () => document.getElementById("chat-send"),
  newBtn: () => document.getElementById("chat-new"),
  status: () => document.getElementById("chat-status"),
};

function renderMessages() {
  const box = $chat.messages();
  if (!box) return;
  box.innerHTML = "";
  for (const m of chatState.messages) {
    const div = document.createElement("div");
    div.className =
      "chat-msg " + (m.role === "user" ? "chat-msg-user" : "chat-msg-assistant");
    div.textContent = m.content;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function setChatStatus(text, kind = "") {
  const el = $chat.status();
  if (!el) return;
  el.textContent = text || "";
  el.className = "chat-status" + (kind === "error" ? " chat-status-error" : "");
}

function setSendEnabled(on) {
  const b = $chat.send();
  if (b) b.disabled = !on;
}

async function loadLatestSession(cardId, apiUrl, token) {
  try {
    const res = await fetch(`${apiUrl}/api/chat/sessions?card_id=${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const sessions = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    const latest = sessions
      .slice()
      .sort((a, b) =>
        String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
      )[0];
    const detail = await fetch(`${apiUrl}/api/chat/sessions/${latest.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!detail.ok) return null;
    const data = await detail.json();
    return {
      sessionId: latest.id,
      messages: (data.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  } catch {
    return null;
  }
}

async function mountChat(card) {
  const pane = $chat.pane();
  if (!pane) return;
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token || !card?.id) {
    pane.hidden = true;
    chatState.cardId = null;
    return;
  }
  if (chatState.cardId === card.id) {
    pane.hidden = false;
    return;
  }
  chatState.cardId = card.id;
  chatState.sessionId = null;
  chatState.messages = [];
  renderMessages();
  setChatStatus("");
  const titleEl = $chat.title();
  if (titleEl) titleEl.textContent = card.title ? `Chat — ${card.title}` : "Chat";
  pane.hidden = false;

  const session = await loadLatestSession(card.id, apiUrl, token);
  if (session && chatState.cardId === card.id) {
    chatState.sessionId = session.sessionId;
    chatState.messages = session.messages;
    renderMessages();
  }
}

function unmountChat() {
  const pane = $chat.pane();
  if (pane) pane.hidden = true;
  chatState.cardId = null;
  chatState.sessionId = null;
  chatState.messages = [];
}

async function sendChatMessage(text) {
  if (!text || !chatState.cardId || chatState.pending) return;
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    setChatStatus("Reconnect the extension first.", "error");
    return;
  }
  chatState.pending = true;
  setSendEnabled(false);
  chatState.messages.push({ role: "user", content: text });
  renderMessages();
  setChatStatus("Thinking…");
  try {
    const res = await fetch(`${apiUrl}/api/cards/${chatState.cardId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: chatState.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        session_id: chatState.sessionId,
      }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail || detail;
      } catch {
        /* swallow body-parse errors — keep the HTTP code */
      }
      throw new Error(detail);
    }
    const data = await res.json();
    chatState.sessionId = data.session_id || chatState.sessionId;
    chatState.messages.push({
      role: "assistant",
      content: data.answer || "",
    });
    renderMessages();
    setChatStatus("");
  } catch (e) {
    setChatStatus((e && e.message) || "Send failed", "error");
    // Roll back the optimistic user message so the user can retry.
    chatState.messages.pop();
    renderMessages();
  } finally {
    chatState.pending = false;
    setSendEnabled(true);
  }
}

function setVoiceVisualState(state) {
  const btn = $chat.voice();
  if (!btn) return;
  btn.classList.remove("recording", "transcribing", "error");
  if (state === "recording") btn.classList.add("recording");
  else if (state === "transcribing") btn.classList.add("transcribing");
  else if (state === "error") btn.classList.add("error");
  if (state === "recording") setChatStatus("Recording — click again to stop.");
  else if (state === "transcribing") setChatStatus("Transcribing…");
  else if (state === "error") setChatStatus("Voice failed — try again.", "error");
  else setChatStatus("");
}

function buildVoiceRecorder(apiUrl, token) {
  return createVoiceRecorder({
    endpoint: `${apiUrl}/api/transcribe`,
    getAuthToken: () => token,
    onTranscribed: (text) => {
      const ta = $chat.input();
      if (!ta) return;
      const { next, caret } = insertAtCaret(ta, ta.value, text);
      ta.value = next;
      setTimeout(() => {
        ta.setSelectionRange(caret, caret);
        ta.focus();
      }, 0);
    },
    onError: (msg) => console.warn("[mindshift] voice error:", msg),
    onStateChange: setVoiceVisualState,
  });
}

function wireChatEvents() {
  const form = $chat.form();
  if (!form) return; // chat-pane not present in DOM, skip
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ta = $chat.input();
    const text = (ta?.value || "").trim();
    if (!text) return;
    ta.value = "";
    void sendChatMessage(text);
  });
  $chat.input().addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  $chat.newBtn().addEventListener("click", () => {
    chatState.sessionId = null;
    chatState.messages = [];
    renderMessages();
    setChatStatus("");
    $chat.input().focus();
  });
  $chat.voice().addEventListener("click", async () => {
    const cur = chatState.voice?.getState?.();
    if (cur === "recording") {
      chatState.voice.stop();
      return;
    }
    if (cur === "transcribing" || cur === "requesting") {
      chatState.voice.cancel();
      return;
    }
    const stored = await chrome.storage.local.get(["apiUrl", "token"]);
    const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
    const token = stored.token || "";
    if (!apiUrl || !token) {
      setChatStatus("Reconnect the extension first.", "error");
      return;
    }
    chatState.voice = buildVoiceRecorder(apiUrl, token);
    if (!chatState.voice.isSupported) {
      setChatStatus("Voice not available in this browser.", "error");
      return;
    }
    chatState.voice.start();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireChatEvents);
} else {
  wireChatEvents();
}

// Exported hook — called from the existing card-resolve flow above.
// Lives on globalThis so we don't need to refactor imports in this file.
globalThis.chatOnCardResolved = function (card) {
  if (card?.id) {
    void mountChat(card);
  } else {
    unmountChat();
  }
};
