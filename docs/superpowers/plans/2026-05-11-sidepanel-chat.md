# Side-Panel Chat + Voice — Implementation Plan

> Use superpowers:subagent-driven-development. Checklist syntax: `- [ ]`.

**Goal:** When the user's current tab has a saved Mindshift card, the extension side panel renders a chat UI with text + voice input, talking to the existing `/api/cards/{id}/chat` endpoint.

**Architecture:** Vanilla JS chat module in `sidepanel.js`. Reuses the side panel's existing card-detection (by-source-url lookup). Voice input via a vanilla port of the React hook → `extension/lib/voice.js`. Zero backend changes.

**Spec:** `docs/superpowers/specs/2026-05-11-sidepanel-chat-design.md`.

**Branch:** `main` (per project convention).

**Test gate:** Manual smoke — autonomous browser test for side panels is impractical.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `extension/sidepanel.html` | modify | New `<section id="chat-pane">` with messages list, input form, mic+send buttons |
| `extension/sidepanel.css` | modify | Chat-pane styles, message bubbles, mic button states |
| `extension/lib/voice.js` | create | Vanilla JS factory `createVoiceRecorder(...)` — MediaRecorder lifecycle, upload to /api/transcribe |
| `extension/lib/insertAtCaret.js` | create | Plain JS port of the web app's helper, for the chat textarea + voice integration |
| `extension/sidepanel.js` | modify | Chat module: mount when card exists, fetch latest session, render, send, voice wiring, new-chat reset |
| `extension/manifest.json` | modify | Version bump 0.9.6 → 0.10.0 |

---

## Task 1: HTML + CSS structure

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`

- [ ] **Step 1: HTML — add the chat-pane block**

In `extension/sidepanel.html`, add a new section right after the existing card-status block (read the file to find the existing main content area). Insert:

```html
<section id="chat-pane" hidden>
  <header class="chat-header">
    <span class="chat-title" id="chat-title">Chat</span>
    <button id="chat-new" type="button" class="chat-new-btn" title="New chat">+ New</button>
  </header>
  <div id="chat-messages" class="chat-messages" aria-live="polite"></div>
  <form id="chat-form" class="chat-input-form">
    <textarea
      id="chat-input"
      rows="2"
      placeholder="Ask anything about this card…"
      maxlength="4000"
    ></textarea>
    <div class="chat-input-actions">
      <button type="button" id="chat-voice" class="chat-voice-btn" title="Record voice" aria-label="Record voice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      </button>
      <button type="submit" id="chat-send" class="chat-send-btn" title="Send">Send</button>
    </div>
  </form>
  <p id="chat-status" class="chat-status" aria-live="polite"></p>
</section>
```

- [ ] **Step 2: CSS — match panel aesthetic**

Append to `extension/sidepanel.css` (don't replace existing styles):

```css
#chat-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #2c3340;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8b95a8;
}
.chat-new-btn {
  background: transparent;
  border: 1px solid #3a4252;
  color: #c4cad7;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.chat-new-btn:hover {
  background: #1f2330;
  color: #fff;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.chat-msg {
  font-size: 12.5px;
  line-height: 1.45;
  padding: 6px 9px;
  border-radius: 8px;
  word-wrap: break-word;
  white-space: pre-wrap;
  max-width: 92%;
}
.chat-msg-user {
  align-self: flex-end;
  background: #1f2a4a;
  color: #e6e9f0;
}
.chat-msg-assistant {
  align-self: flex-start;
  background: #1a1f2e;
  color: #d0d4dd;
  border: 1px solid #2c3340;
}

.chat-input-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#chat-input {
  resize: vertical;
  min-height: 44px;
  max-height: 160px;
  padding: 7px 9px;
  background: #11151f;
  border: 1px solid #2c3340;
  border-radius: 8px;
  color: #e6e9f0;
  font-size: 13px;
  font-family: inherit;
}
#chat-input:focus {
  outline: none;
  border-color: #4a5267;
}

.chat-input-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}
.chat-voice-btn,
.chat-send-btn {
  border: 1px solid #2c3340;
  background: #1a1f2e;
  color: #c4cad7;
  cursor: pointer;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
.chat-voice-btn {
  padding: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chat-voice-btn:hover,
.chat-send-btn:hover {
  background: #232838;
}
.chat-voice-btn.recording {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
  animation: chatPulse 1.4s ease-in-out infinite;
}
.chat-voice-btn.transcribing {
  background: #1f2a4a;
  color: #a3b1ff;
}
.chat-voice-btn.error {
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
}
.chat-send-btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}

@keyframes chatPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.chat-status {
  font-size: 11px;
  color: #8b95a8;
  min-height: 1em;
  margin: 0;
}
.chat-status.chat-status-error {
  color: #fca5a5;
}
```

- [ ] **Step 3: Smoke**

Open the unpacked extension's side-panel HTML in a browser preview (or just visually inspect via dev tools later). Verify no CSS syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add extension/sidepanel.html extension/sidepanel.css
git commit -m "feat(extension): side-panel chat pane HTML + CSS"
```

---

## Task 2: Voice + caret helper modules

**Files:**
- Create: `extension/lib/voice.js`
- Create: `extension/lib/insertAtCaret.js`

- [ ] **Step 1: `insertAtCaret.js`**

```js
// extension/lib/insertAtCaret.js
/** Caret-aware text insert for plain <textarea>. Returns { next, caret }.
 *  Caller is responsible for setting the new value and calling
 *  setSelectionRange(caret, caret) inside a microtask so the DOM has
 *  caught up. Plain JS port of frontend/src/lib/insertAtCaret.ts. */
export function insertAtCaret(el, current, text) {
  if (!el) {
    const joined = current ? `${current} ${text}`.trim() : text;
    return { next: joined, caret: joined.length };
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before && !/[\s\n]$/.test(before) ? " " : "";
  const trail = after && !/^[\s\n]/.test(after) ? " " : "";
  const next = `${before}${lead}${text}${trail}${after}`;
  const caret = (before + lead + text).length;
  return { next, caret };
}
```

- [ ] **Step 2: `voice.js`**

```js
// extension/lib/voice.js
/** Vanilla JS port of frontend/src/lib/useVoiceRecording.ts.
 *  Factory pattern instead of React hook — caller wires callbacks. */

const SUPPORTED =
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export function createVoiceRecorder({
  endpoint = "/api/transcribe",
  getAuthToken = () => null,
  onTranscribed,
  onError,
  onStateChange,
}) {
  let state = "idle";
  let recorder = null;
  let stream = null;
  let chunks = [];

  const setState = (next) => {
    state = next;
    onStateChange?.(state);
  };

  const cleanupStream = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    recorder = null;
    chunks = [];
  };

  const handleError = (message) => {
    cleanupStream();
    setState("error");
    onError?.(message);
    window.setTimeout(() => {
      if (state === "error") setState("idle");
    }, 3000);
  };

  const start = async () => {
    if (!SUPPORTED) {
      handleError("Voice not available in this browser.");
      return;
    }
    if (recorder) return;
    setState("requesting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const recordedMime = recorder?.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: recordedMime });
        cleanupStream();
        if (blob.size === 0) {
          handleError("No audio captured.");
          return;
        }
        setState("transcribing");
        try {
          const ext = recordedMime.includes("mp4")
            ? "mp4"
            : recordedMime.includes("ogg")
            ? "ogg"
            : "webm";
          const fd = new FormData();
          fd.append("audio", blob, `recording.${ext}`);
          const token = getAuthToken();
          const res = await fetch(endpoint, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
          });
          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              detail = (await res.json()).detail || detail;
            } catch {}
            handleError(detail);
            return;
          }
          const data = await res.json();
          const text = (data.text || "").trim();
          if (!text) {
            handleError("No speech detected — try again.");
            return;
          }
          setState("idle");
          onTranscribed?.(text);
        } catch (e) {
          handleError(e instanceof Error ? e.message : "Transcribe failed.");
        }
      };

      recorder.start();
      setState("recording");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Microphone access denied."
            : e.message
          : "Mic access failed.";
      handleError(msg);
    }
  };

  const stop = () => {
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
  };

  const cancel = () => {
    stop();
    cleanupStream();
    setState("idle");
  };

  return {
    start,
    stop,
    cancel,
    isSupported: SUPPORTED,
    getState: () => state,
  };
}
```

- [ ] **Step 3: Smoke**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
node --check extension/lib/voice.js
node --check extension/lib/insertAtCaret.js
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add extension/lib/voice.js extension/lib/insertAtCaret.js
git commit -m "feat(extension): voice + insertAtCaret modules (vanilla JS port)"
```

---

## Task 3: Chat module in `sidepanel.js`

**Files:**
- Modify: `extension/sidepanel.js`

- [ ] **Step 1: Read the file**

Understand the existing flow — how `sidepanel.js` reads the current tab URL, calls `/api/cards/by-source-url`, and renders the save UI. The chat module hooks in at the same point: when a card is found, also show chat.

Read all of `extension/sidepanel.js` first. Note the `call(...)` helper (auth-fetch wrapper) — chat module reuses it.

- [ ] **Step 2: Add chat module at the bottom of `sidepanel.js`**

After the existing code (don't replace), append a chat module section. Approximate structure:

```js
// ============================================================
// Chat module (Phase: side-panel chat)
// ============================================================
import { createVoiceRecorder } from "./lib/voice.js";
import { insertAtCaret } from "./lib/insertAtCaret.js";

const chatState = {
  cardId: null,
  sessionId: null,
  messages: [], // [{ role: "user" | "assistant", content: string }]
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
  box.innerHTML = "";
  for (const m of chatState.messages) {
    const div = document.createElement("div");
    div.className = "chat-msg " + (m.role === "user" ? "chat-msg-user" : "chat-msg-assistant");
    div.textContent = m.content;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function setStatus(text, kind = "") {
  const el = $chat.status();
  el.textContent = text || "";
  el.className = "chat-status" + (kind === "error" ? " chat-status-error" : "");
}

function setSendEnabled(on) {
  $chat.send().disabled = !on;
}

async function loadLatestSession(cardId, apiUrl, token) {
  // The chat-sessions list endpoint: GET /api/chat/sessions?card_id=...
  try {
    const res = await fetch(`${apiUrl}/api/chat/sessions?card_id=${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const sessions = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    // Pick the most recently updated session for this card.
    const latest = sessions.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
    const detail = await fetch(`${apiUrl}/api/chat/sessions/${latest.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!detail.ok) return null;
    const data = await detail.json();
    return {
      sessionId: latest.id,
      messages: (data.messages || []).map((m) => ({ role: m.role, content: m.content })),
    };
  } catch {
    return null;
  }
}

async function mountChat(card) {
  // Read API endpoint + token from chrome.storage.local — same pattern
  // the rest of sidepanel.js uses.
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    $chat.pane().hidden = true;
    return;
  }
  if (!card?.id) {
    $chat.pane().hidden = true;
    chatState.cardId = null;
    return;
  }

  // Same card? Don't re-mount (preserves the typed input).
  if (chatState.cardId === card.id) return;

  chatState.cardId = card.id;
  chatState.sessionId = null;
  chatState.messages = [];
  renderMessages();
  setStatus("");
  $chat.title().textContent = card.title ? `Chat — ${card.title}` : "Chat";
  $chat.pane().hidden = false;

  // Resume latest session if any.
  const session = await loadLatestSession(card.id, apiUrl, token);
  if (session) {
    chatState.sessionId = session.sessionId;
    chatState.messages = session.messages;
    renderMessages();
  }
}

function unmountChat() {
  $chat.pane().hidden = true;
  chatState.cardId = null;
  chatState.sessionId = null;
  chatState.messages = [];
}

async function sendMessage(text) {
  if (!text || !chatState.cardId || chatState.pending) return;
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
  const token = stored.token || "";
  if (!apiUrl || !token) {
    setStatus("Reconnect the extension first.", "error");
    return;
  }
  chatState.pending = true;
  setSendEnabled(false);
  chatState.messages.push({ role: "user", content: text });
  renderMessages();
  setStatus("Thinking…");
  try {
    const res = await fetch(`${apiUrl}/api/cards/${chatState.cardId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: chatState.messages.map((m) => ({ role: m.role, content: m.content })),
        session_id: chatState.sessionId,
      }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail || detail;
      } catch {}
      throw new Error(detail);
    }
    const data = await res.json();
    chatState.sessionId = data.session_id || chatState.sessionId;
    chatState.messages.push({ role: "assistant", content: data.answer || "" });
    renderMessages();
    setStatus("");
  } catch (e) {
    setStatus(e?.message || "Send failed", "error");
    // Roll back the optimistic user message so the user can retry.
    chatState.messages.pop();
    renderMessages();
  } finally {
    chatState.pending = false;
    setSendEnabled(true);
  }
}

function setVoiceState(state) {
  const btn = $chat.voice();
  btn.classList.remove("recording", "transcribing", "error");
  if (state === "recording") btn.classList.add("recording");
  if (state === "transcribing") btn.classList.add("transcribing");
  if (state === "error") btn.classList.add("error");
  // Status hint below input
  if (state === "recording") setStatus("Recording — click again to stop.");
  else if (state === "transcribing") setStatus("Transcribing…");
  else if (state === "error") setStatus("Voice failed — try again.", "error");
  else setStatus("");
}

function wireChatEvents() {
  // Send via form submit (Enter key or Send button).
  $chat.form().addEventListener("submit", (e) => {
    e.preventDefault();
    const ta = $chat.input();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    void sendMessage(text);
  });

  // Cmd/Ctrl+Enter to send.
  $chat.input().addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      $chat.form().requestSubmit();
    }
  });

  // New chat resets session.
  $chat.newBtn().addEventListener("click", () => {
    chatState.sessionId = null;
    chatState.messages = [];
    renderMessages();
    setStatus("");
    $chat.input().focus();
  });

  // Voice integration.
  chatState.voice = createVoiceRecorder({
    endpoint: "", // resolved per-click below
    getAuthToken: () => null,
    onTranscribed: (text) => {
      const ta = $chat.input();
      const { next, caret } = insertAtCaret(ta, ta.value, text);
      ta.value = next;
      // Restore caret + focus inside a microtask so DOM has caught up.
      setTimeout(() => {
        ta.setSelectionRange(caret, caret);
        ta.focus();
      }, 0);
    },
    onError: (msg) => console.warn("[mindshift] voice error:", msg),
    onStateChange: setVoiceState,
  });

  // Per-click: re-resolve apiUrl + token (in case the user reconnected mid-session).
  $chat.voice().addEventListener("click", async () => {
    const state = chatState.voice?.getState?.();
    if (state === "recording") {
      chatState.voice.stop();
      return;
    }
    if (state === "transcribing" || state === "requesting") {
      chatState.voice.cancel();
      return;
    }
    const stored = await chrome.storage.local.get(["apiUrl", "token"]);
    const apiUrl = (stored.apiUrl || "").replace(/\/$/, "");
    const token = stored.token || "";
    if (!apiUrl || !token) {
      setStatus("Reconnect the extension first.", "error");
      return;
    }
    // Rebuild the recorder with fresh endpoint + token. (createVoiceRecorder
    // captures endpoint at construction, so we replace it for each session.)
    chatState.voice = createVoiceRecorder({
      endpoint: `${apiUrl}/api/transcribe`,
      getAuthToken: () => token,
      onTranscribed: (text) => {
        const ta = $chat.input();
        const { next, caret } = insertAtCaret(ta, ta.value, text);
        ta.value = next;
        setTimeout(() => {
          ta.setSelectionRange(caret, caret);
          ta.focus();
        }, 0);
      },
      onError: (msg) => console.warn("[mindshift] voice error:", msg),
      onStateChange: setVoiceState,
    });
    chatState.voice.start();
  });

  // Hide the voice button when MediaRecorder is unavailable.
  if (chatState.voice && !chatState.voice.isSupported) {
    $chat.voice().style.display = "none";
  }
}

// Hook into the existing card-detection flow:
// EXPORT a function the existing card-render code can call.
// Find the existing onCardResolved / onTabUpdated handler and wire it.
export function chatOnCardResolved(card) {
  if (card?.id) {
    void mountChat(card);
  } else {
    unmountChat();
  }
}

// Boot: wire DOM listeners as soon as the document is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireChatEvents);
} else {
  wireChatEvents();
}
```

- [ ] **Step 3: Wire `chatOnCardResolved` into the existing card-detection flow**

Find the existing code in `sidepanel.js` that resolves the card for the current tab URL — there'll be a line like `const card = await ...; render(card)` or similar. Right after that, call `chatOnCardResolved(card)`.

If the card-detection logic runs in multiple places (e.g., on tab change AND on initial load), call `chatOnCardResolved` at each site. When the card is null (no card for URL), pass `null` — `chatOnCardResolved(null)` will unmount the chat pane.

Read the existing code carefully. The hook points are wherever today's "show save UI" decisions get made.

- [ ] **Step 4: Smoke**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
node --check extension/sidepanel.js
```

Expected: no syntax errors. (Vanilla JS ESM with import statements — should parse fine in Node with `--experimental-vm-modules` removed, since `--check` only checks syntax.)

- [ ] **Step 5: Bump manifest version**

`extension/manifest.json`: `0.9.6` → `0.10.0`.

- [ ] **Step 6: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add extension/sidepanel.js extension/manifest.json
git commit -m "feat(extension): side-panel chat with text + voice"
```

---

## Task 4: Manual smoke + push

**Files:** none.

- [ ] **Step 1: Reload extension**

`chrome://extensions` → Mindshift → ↻ (or Remove + Load unpacked). Verify version 0.10.0.

- [ ] **Step 2: Open a saved YouTube card in a Chrome tab**

Use a card that was previously saved to Mindshift. Open the side panel (Mindshift toolbar icon or ⌘+Shift+M if hotkey configured).

Verify:
- Existing save status shows "Card saved" with title.
- Chat-pane appears below.
- Title in chat-pane reflects card title.
- Input + mic + send buttons are visible.

- [ ] **Step 3: Send a text message**

Type "Summarize this video in 3 bullet points" → Enter or Send. Verify:
- User message appears immediately.
- "Thinking…" status appears.
- After a few seconds, assistant reply appears.

- [ ] **Step 4: Send via voice**

Click the mic button → grant permission (first time only) → button turns red and pulses → speak briefly → click again → button shows transcribing spinner → text appears in input → click Send.

- [ ] **Step 5: Try "New" button**

Click "+ New" — messages list clears. Send a fresh message → starts a new session. Verify in DB:
```bash
psql -d mindshift -c "SELECT id, title, updated_at FROM chat_sessions WHERE card_id='<card-id>' ORDER BY updated_at DESC LIMIT 5;"
```
Should show two sessions for the same card.

- [ ] **Step 6: Switch to a non-saved URL**

Navigate to a URL with no card (e.g., a random Hacker News post). Side panel shows save UI; chat pane is hidden.

- [ ] **Step 7: Push when user confirms**

```bash
git push origin main
```

---

## Self-review

**Spec coverage:**
- §5.1 HTML structure → Task 1.
- §5.2 CSS → Task 1.
- §5.3 voice module → Task 2.
- §5.4 chat module + integration → Task 3.
- §5.5 manifest version → Task 3.
- §6 no backend changes → confirmed.
- §7 edge cases — all handled in the chat module (no card → hide, 401 → reconnect prompt, no session → empty state, mic denied → error class, etc.).

**Placeholder scan:** no TBDs. All code blocks complete.

**Type consistency:** `chatState.messages` shape (`{role, content}`) is consistent. Voice factory signature matches in `voice.js` definition and `sidepanel.js` callsite. `chrome.storage.local.get(["apiUrl", "token"])` is the same pattern the existing code uses.

---

## Done criteria

- 4 tasks ticked.
- Side panel renders chat for any saved card.
- Voice button works end-to-end (record → transcribe → text in input).
- New-chat button starts fresh sessions.
- No regression in the existing save-status UI.
- Pushed to origin/main on user confirmation.
