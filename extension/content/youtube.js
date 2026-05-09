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
