/* Mindshift YouTube content script.
 *
 * Injects a "Save to Mindshift" pill into the YouTube watch page
 * action bar (next to Like / Share). On click it asks the background
 * service worker to POST /api/cards/from-url for the current video,
 * then flips the button to a "Saved · Open" state.
 *
 * YouTube is a SPA — the action bar is rebuilt on every video
 * navigation. We watch for that and re-inject. The injection is also
 * idempotent (early-out when the button is already there).
 */

// First line of execution — emit a banner so we can verify the script
// loaded at all. If this banner doesn't appear in the DevTools console,
// the manifest didn't match the URL or the extension wasn't reloaded.
console.info(
  "%c[Mindshift] %ccontent script loaded — version 0.3 — on " + window.location.href,
  "color: #8b5cf6; font-weight: bold",
  "color: inherit",
);

const BUTTON_ID = "mindshift-save-btn";
const POLL_INTERVAL_MS = 800;
const MAX_POLL_ATTEMPTS = 30;

// Last URL the button reflected — when YouTube navigates to a new video
// without a full page load, we reset the button so a stale "saved" state
// doesn't carry over.
let lastUrl = "";

function findActionBar() {
  // YouTube renders the like/dislike/share/etc buttons inside
  // `#top-level-buttons-computed` (a ytd-menu-renderer's slot).
  // It can take a moment to mount on hard navigations.
  // We try multiple selectors because YouTube redesigns the watch page
  // every few months and the exact path drifts.
  const selectors = [
    "ytd-watch-metadata #top-level-buttons-computed",
    "#top-level-buttons-computed",
    // Newer YouTube redesign — segmented like/dislike pill block:
    "ytd-watch-metadata #actions",
    "ytd-watch-metadata #actions-inner",
    "#actions-inner",
    // Last-resort: whatever holds the share button.
    "ytd-menu-renderer.ytd-watch-metadata",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function buildButton(state) {
  // state: "save" | "saved" | "saving" | "error"
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.className = `mindshift-save-btn mindshift-state-${state}`;
  const label =
    state === "saved"
      ? "Open"
      : state === "saving"
        ? "Saving…"
        : state === "error"
          ? "Retry"
          : "Save";
  btn.innerHTML = `
    <span class="ms-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${
          state === "saved"
            ? '<polyline points="20 6 9 17 4 12"></polyline>'
            : '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>'
        }
      </svg>
    </span>
    <span class="ms-label">${label}</span>
  `;
  return btn;
}

function setButtonState(btn, state, opts = {}) {
  if (!btn) return;
  btn.className = `mindshift-save-btn mindshift-state-${state}`;
  const label = btn.querySelector(".ms-label");
  if (label) {
    label.textContent =
      state === "saved"
        ? "Open"
        : state === "saving"
          ? "Saving…"
          : state === "error"
            ? "Retry"
            : "Save";
  }
  // Replace the icon SVG path content for the saved state.
  const svg = btn.querySelector(".ms-icon svg");
  if (svg) {
    svg.innerHTML =
      state === "saved"
        ? '<polyline points="20 6 9 17 4 12"></polyline>'
        : '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>';
  }
  if (opts.title) btn.title = opts.title;
  btn.dataset.cardId = opts.cardId || "";
}

async function handleClick(btn) {
  const state = btn.className.includes("mindshift-state-saved") ? "saved" : "save";
  if (state === "saved" && btn.dataset.cardId) {
    chrome.runtime.sendMessage({
      type: "openSidePanel",
      tabId: undefined, // background pulls from sender.tab
    });
    return;
  }
  setButtonState(btn, "saving");
  try {
    const res = await chrome.runtime.sendMessage({
      type: "savePage",
      url: window.location.href,
    });
    if (res?.ok && res.cardId) {
      setButtonState(btn, "saved", {
        cardId: res.cardId,
        title: `Saved as "${(res.title || "").slice(0, 80)}"`,
      });
    } else if (res?.code === "auth") {
      setButtonState(btn, "error", { title: "Reconnect the extension" });
    } else {
      setButtonState(btn, "error", { title: res?.error || "Save failed" });
    }
  } catch (err) {
    setButtonState(btn, "error", { title: String(err) });
  }
}

async function inject() {
  if (document.getElementById(BUTTON_ID)) return; // idempotent
  const bar = findActionBar();
  if (!bar) {
    console.debug("[Mindshift] action bar not found yet");
    return;
  }

  console.debug("[Mindshift] mounting Save button into", bar);
  const btn = buildButton("save");
  btn.addEventListener("click", () => void handleClick(btn));
  bar.prepend(btn);

  // Tell the user (visually) if the current video is already saved —
  // so the button reads "Open" right away.
  const url = window.location.href;
  lastUrl = url;
  try {
    const res = await chrome.runtime.sendMessage({ type: "lookupCardForUrl", url });
    if (res?.ok && res.cardId) {
      setButtonState(btn, "saved", { cardId: res.cardId, title: "Open in Mindshift" });
    } else if (res?.configured === false) {
      setButtonState(btn, "error", { title: "Extension not configured" });
    }
  } catch {
    /* lookup is best-effort */
  }
}

function pollUntilInjected() {
  let attempts = 0;
  const id = window.setInterval(() => {
    attempts++;
    if (document.getElementById(BUTTON_ID) || attempts > MAX_POLL_ATTEMPTS) {
      window.clearInterval(id);
      return;
    }
    void inject();
  }, POLL_INTERVAL_MS);
}

// Re-inject on YouTube SPA navigations — they replace the watch page
// content without a full reload.
function watchForNavigations() {
  let last = window.location.href;
  const tick = () => {
    if (window.location.href !== last) {
      last = window.location.href;
      // Old button belongs to the previous video; remove and start over.
      document.getElementById(BUTTON_ID)?.remove();
      pollUntilInjected();
    }
  };
  // YouTube fires this custom event on navigations.
  window.addEventListener("yt-navigate-finish", tick);
  // Belt + suspenders: also poll the URL, since the custom event is
  // not 100% reliable across YouTube redesigns.
  window.setInterval(tick, 1000);
}

console.info(
  "[Mindshift] content script loaded on",
  window.location.href,
  "— if no Save pill appears, run: document.querySelector('#mindshift-save-btn') in DevTools",
);
void inject();
pollUntilInjected();
watchForNavigations();
void lastUrl; // prevent unused-var warnings if the SPA never navigates

/* ===================== Block N: timestamp + auto-save ===================== */

const TS_BUTTON_ID = "mindshift-timestamp-btn";

function videoElement() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}

function currentVideoSeconds() {
  const v = videoElement();
  if (!v) return null;
  const t = Math.floor(v.currentTime || 0);
  return Number.isFinite(t) && t > 0 ? t : null;
}

function formatTimestamp(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function videoIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (/youtube\.com$/.test(u.hostname) || /\.youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {
    /* malformed */
  }
  return null;
}

function buildTimestampButton() {
  const btn = document.createElement("button");
  btn.id = TS_BUTTON_ID;
  btn.type = "button";
  btn.className = "mindshift-save-btn mindshift-state-save mindshift-ts-btn";
  btn.title = "Save the current playback timestamp as a note bookmark";
  btn.innerHTML = `
    <span class="ms-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    </span>
    <span class="ms-label ms-ts-label">📌 0:00</span>
  `;
  return btn;
}

function updateTimestampLabel(btn) {
  const seconds = currentVideoSeconds();
  const label = btn.querySelector(".ms-ts-label");
  if (!label) return;
  if (seconds == null) {
    label.textContent = "📌 Save spot";
  } else {
    label.textContent = `📌 ${formatTimestamp(seconds)}`;
  }
}

async function patchCardNotes(cardId, appendChunk) {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(["apiUrl", "token"], resolve);
  });
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) return { ok: false, error: "Extension not configured" };

  // Load existing notes first so we can append rather than overwrite —
  // there's no dedicated append endpoint, but PATCH /notes already
  // exists.
  let existing = "";
  try {
    const r = await fetch(`${apiUrl}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const data = await r.json();
      existing = data.notes_md ?? "";
    }
  } catch {
    /* tolerate — worst case we replace the notes with the chunk */
  }
  const next = existing && existing.trim().length > 0
    ? `${existing.replace(/\s+$/, "")}\n${appendChunk}`
    : appendChunk;

  const r2 = await fetch(`${apiUrl}/api/cards/${cardId}/notes`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notes_md: next }),
  });
  if (!r2.ok) return { ok: false, error: `HTTP ${r2.status}` };
  return { ok: true };
}

async function handleTimestampClick(btn) {
  const seconds = currentVideoSeconds();
  if (seconds == null) {
    btn.title = "Start playing the video first.";
    return;
  }
  const url = window.location.href;
  const vid = videoIdFromUrl(url);
  if (!vid) {
    btn.title = "Could not parse video id.";
    return;
  }
  const stamp = formatTimestamp(seconds);
  const linkUrl = `https://www.youtube.com/watch?v=${vid}&t=${seconds}s`;
  const chunk = `- [${stamp}](${linkUrl}) `;

  const oldLabel = btn.querySelector(".ms-ts-label")?.textContent || "";
  const setLabel = (text) => {
    const l = btn.querySelector(".ms-ts-label");
    if (l) l.textContent = text;
  };
  setLabel("Saving…");
  btn.classList.add("mindshift-state-saving");
  try {
    // Use the existing save flow which is idempotent — if the card
    // already exists for this URL, we get its id back and just
    // append the bookmark.
    const saveRes = await chrome.runtime.sendMessage({
      type: "savePage",
      url,
    });
    if (!saveRes?.ok || !saveRes.cardId) {
      throw new Error(saveRes?.error || "Could not save the video");
    }
    const noteRes = await patchCardNotes(saveRes.cardId, chunk);
    if (!noteRes.ok) throw new Error(noteRes.error || "Could not append the bookmark");
    setLabel(`✓ ${stamp}`);
    btn.classList.remove("mindshift-state-saving");
    btn.classList.add("mindshift-state-saved");
    window.setTimeout(() => {
      btn.classList.remove("mindshift-state-saved");
      setLabel(oldLabel);
    }, 2200);
  } catch (err) {
    btn.classList.remove("mindshift-state-saving");
    btn.classList.add("mindshift-state-error");
    btn.title = String(err?.message || err);
    setLabel("Retry");
    window.setTimeout(() => {
      btn.classList.remove("mindshift-state-error");
      setLabel(oldLabel);
    }, 2500);
  }
}

function injectTimestampButton() {
  if (document.getElementById(TS_BUTTON_ID)) return;
  const saveBtn = document.getElementById(BUTTON_ID);
  if (!saveBtn || !saveBtn.parentNode) return;
  const tsBtn = buildTimestampButton();
  tsBtn.addEventListener("click", () => void handleTimestampClick(tsBtn));
  saveBtn.parentNode.insertBefore(tsBtn, saveBtn.nextSibling);
  // Live-update the label so the user always sees the current
  // timestamp baked into the button. Cheap — runs once per second.
  const id = window.setInterval(() => {
    if (!document.getElementById(TS_BUTTON_ID)) {
      window.clearInterval(id);
      return;
    }
    updateTimestampLabel(tsBtn);
  }, 1000);
  updateTimestampLabel(tsBtn);
}

// Poll for the save button to appear, then inject the timestamp
// sibling. We piggy-back on the same interval cadence as
// pollUntilInjected so we don't add a parallel poll loop.
{
  let attempts = 0;
  const id = window.setInterval(() => {
    attempts++;
    if (document.getElementById(BUTTON_ID)) {
      injectTimestampButton();
    }
    if (document.getElementById(TS_BUTTON_ID) || attempts > MAX_POLL_ATTEMPTS) {
      window.clearInterval(id);
    }
  }, POLL_INTERVAL_MS);
}

/* --------------------- Auto-save on video end --------------------- */

const AUTO_SAVE_KEY = "autoSaveYouTubeOnEnd";

async function isAutoSaveEnabled() {
  try {
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get([AUTO_SAVE_KEY], resolve);
    });
    return !!stored?.[AUTO_SAVE_KEY];
  } catch {
    return false;
  }
}

let autoSaveAttached = false;
let autoSaveFiredFor = "";

async function attachAutoSaveListener() {
  if (autoSaveAttached) return;
  if (!(await isAutoSaveEnabled())) return;
  const v = videoElement();
  if (!v) return;
  autoSaveAttached = true;
  v.addEventListener("ended", () => {
    const url = window.location.href;
    // Guard against the same URL firing twice on replay loops.
    if (autoSaveFiredFor === url) return;
    autoSaveFiredFor = url;
    chrome.runtime.sendMessage({ type: "savePage", url }, (res) => {
      if (!res?.ok) {
        console.warn("[Mindshift] auto-save failed:", res?.error);
      }
    });
  });
}

// Reset the auto-save firing guard on SPA navigation.
window.addEventListener("yt-navigate-finish", () => {
  autoSaveFiredFor = "";
  autoSaveAttached = false;
  // Wait briefly for the new <video> to mount.
  window.setTimeout(() => void attachAutoSaveListener(), 1500);
});

void attachAutoSaveListener();
{
  // Belt-and-suspenders: video element can mount late on first load.
  let attempts = 0;
  const id = window.setInterval(() => {
    attempts++;
    if (autoSaveAttached || attempts > MAX_POLL_ATTEMPTS) {
      window.clearInterval(id);
      return;
    }
    void attachAutoSaveListener();
  }, POLL_INTERVAL_MS);
}

// Listen for background-broadcast cardSaved messages. Fired whenever
// any save path (toolbar button, hotkey, side panel auto-add) writes
// a card for the current tab — we need this on the YouTube content
// script so the in-page Save button flips to "Saved → Open" without
// a page reload.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "cardSaved" || !msg?.cardId) return;
  // Match URLs loosely: YouTube SPA navigations can keep the cardSaved
  // URL slightly out of sync with location.href (extra params, fragment
  // tweaks). Compare just the watch?v=<id> portion.
  const here = window.location.href;
  if (!sameVideo(here, msg.url)) return;
  const btn = document.getElementById(BUTTON_ID);
  if (!btn) return;
  setButtonState(btn, "saved", {
    cardId: msg.cardId,
    title: "Open in Mindshift",
  });
});

function sameVideo(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const aId = ua.hostname.includes("youtu.be")
      ? ua.pathname.slice(1).split("/")[0]
      : ua.searchParams.get("v");
    const bId = ub.hostname.includes("youtu.be")
      ? ub.pathname.slice(1).split("/")[0]
      : ub.searchParams.get("v");
    if (aId && bId) return aId === bId;
    return a === b;
  } catch {
    return a === b;
  }
}
