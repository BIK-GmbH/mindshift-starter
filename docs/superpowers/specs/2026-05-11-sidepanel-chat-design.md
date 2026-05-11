# Extension Side-Panel Chat — Design Spec

**Date:** 2026-05-11
**Status:** User-approved scope. (b) chat on any saved card + (yes) voice input.

---

## 1. Problem

The extension side panel currently confirms whether the current tab's URL has a saved Mindshift card and offers Save / Save-as-Paused. That's it. The user wants to **chat with the card directly in the side panel** — ask questions about the YouTube video / article / PDF without switching to the web app.

The Mindshift backend already has the right endpoint: `POST /api/cards/{card_id}/chat`. It's auth-gated, persists messages in `chat_sessions`, returns `{ answer, session_id }`. Zero backend work needed.

Plus: voice input — the user wants the same dictation pattern shipped in the web app (`/api/transcribe` → text inserted at the caret) inside the side panel.

## 2. Goals

- Side panel detects the current tab's URL, looks up the card, and renders a chat UI if a card exists.
- Chat works for **any** saved card (YouTube, article, PDF, GitHub repo, etc.) — not just YouTube.
- Resume the most recent chat session for that card on panel open (continue the conversation, not always start fresh).
- "New chat" button to start a clean session manually.
- Voice input: mic button next to the send button → records → posts to `/api/transcribe` → inserts text into the input field at the caret position.
- No backend changes — every endpoint already exists.

## 3. Non-goals

- **No streaming responses** in this phase. `/cards/{id}/chat` returns the full answer; we wait and render.
- **No multi-card chat orchestration.** One chat per card; switching tabs swaps the chat context.
- **No long-history pagination.** Load the most recent session in one fetch. If a session has thousands of messages it'll be slow — acceptable for now.
- **No mid-message edit/delete.** Standard chat append-only.
- **No file/image upload.** Pure text + voice input.
- **No web-app parity for UX details** (markdown rendering, citations UI, code blocks) — text-only rendering in the panel. Markdown formatting in responses gets shown as plain text for now.

## 4. Architecture

```
Side-panel (chrome-extension:// HTML page)
├── on open: read activeTab URL → GET /api/cards/by-source-url?url=<canon>
│            │
│            ├── card.id missing → show existing save UI (today's behaviour)
│            └── card.id found → show chat UI
│                  ├── GET /api/cards/{card.id}/chat/sessions?limit=1
│                  │     → if session exists, GET /chat/sessions/{id} for messages
│                  ├── render messages
│                  └── input area (textarea + mic + send)
│
├── send message: POST /api/cards/{card.id}/chat { messages, session_id? }
│                 → append { user, assistant } pair to UI, store session_id
│
├── new chat: clear in-memory session_id → next send creates a fresh session
│
└── voice: lib/voice.js → MediaRecorder → blob → POST /api/transcribe
            → response.text → insert at textarea caret
```

The side panel is a regular HTML page running at `chrome-extension://<id>/sidepanel.html`. MediaRecorder + `getUserMedia` work after user-granted permission; no new manifest permissions needed.

## 5. Frontend changes — Extension

### 5.1 `extension/sidepanel.html`
Add a `<section id="chat-pane" hidden>` below the existing save section:

```html
<section id="chat-pane" hidden>
  <header class="chat-header">
    <span class="chat-title" id="chat-title">Chat</span>
    <button id="chat-new" type="button" title="New chat">+ New</button>
  </header>
  <div id="chat-messages" class="chat-messages" aria-live="polite"></div>
  <form id="chat-form" class="chat-input">
    <textarea id="chat-input" rows="2" placeholder="Ask anything about this card…"></textarea>
    <div class="chat-input-actions">
      <button type="button" id="chat-voice" title="Record voice" aria-label="Record voice">
        <!-- mic icon SVG inline -->
      </button>
      <button type="submit" id="chat-send" title="Send">Send</button>
    </div>
  </form>
  <p id="chat-status" class="chat-status" aria-live="polite"></p>
</section>
```

### 5.2 `extension/sidepanel.css`
Add scoped styles for the chat pane. Match the existing aesthetic (dark ink palette, monospace timestamps if any). Keep the panel narrow (Chrome side-panel is ~320 px). Messages stack vertically, user messages right-aligned, assistant left-aligned, both with subtle backgrounds. Mic button is small and changes color when recording.

### 5.3 `extension/lib/voice.js` — new
Plain-JS port of `frontend/src/lib/useVoiceRecording.ts`. Exports a small factory:

```js
export function createVoiceRecorder({ endpoint, getAuthToken, onTranscribed, onError, onStateChange }) {
  // returns { start, stop, cancel, isSupported }
}
```

Same state machine (idle → requesting → recording → transcribing → error). Same MediaRecorder MIME fallback chain. Same 5 MB transcribe payload cap. The factory pattern fits vanilla JS better than the React hook signature.

### 5.4 `extension/sidepanel.js`
Add a chat module — three concerns:
- **Mount**: when a card is detected, fetch most-recent session, render messages, show the chat pane. When card disappears (tab change, save deleted), hide the pane.
- **Send**: POST to `/api/cards/{id}/chat` with the current message history + optional `session_id` (from the most recent send). Append user message immediately (optimistic), then append assistant reply on response. Store `session_id` from the response.
- **Voice**: wire `createVoiceRecorder({onTranscribed: insertAtCaret})` to the mic button. Reuse the small `insertAtCaret(textarea, current, text)` helper from the web app (port to plain JS in `lib/voice.js` or a sibling).

### 5.5 `extension/manifest.json`
Bump version (`0.9.6` → `0.10.0` — minor bump because of feature, not patch).

## 6. Backend — no changes

All endpoints exist and are auth-gated:
- `GET /api/cards/by-source-url` — already used by the panel
- `GET /api/chat/sessions?card_id=…&limit=1` — verify exists, adapt query shape if needed
- `GET /api/chat/sessions/{session_id}` — fetch messages of a session
- `POST /api/cards/{card_id}/chat` — main message endpoint
- `POST /api/transcribe` — voice endpoint shipped in the voice-to-text phase

## 7. Edge cases

- **No card for current URL** → existing save UI; chat pane hidden.
- **Card processing not finished** → backend's chat endpoint might error or return useless answers. Show a banner "Card is still processing — chat available after summarization completes". Disable input.
- **Token expired (401)** → existing reconnect-CTA reused; chat pane hidden until reconnected.
- **OPENAI_API_KEY missing on server** → 503 → show "Chat unavailable — server not configured".
- **Empty message submission** → no-op (button stays disabled when input empty).
- **Mic permission denied** → mic button shows error state for 3 s, returns to idle. Same UX as web app.
- **Tab switch while recording** → side panel survives (panel is per-window, not per-tab), but the card context might change underneath. Cancel recording when card context changes.
- **No active session for the card** → render empty state ("Ask the first question…"); first send creates a new session server-side (existing `_ensure_session` flow in chat.py).
- **Tab URL changes via SPA navigation** → existing side panel already listens for tab updates and re-fetches the card. Same trigger drives chat re-mount.

## 8. Testing

- Manual: open YouTube card-page, open side panel, send message, get response.
- Manual: voice — click mic, speak, click again, text appears in input. Edit + send.
- Manual: new-chat button clears the conversation, starts fresh on next send.
- Manual: navigate to a page with no card → save UI visible, chat hidden.
- Manual: token expired → chat hidden, reconnect prompt visible.

No autonomous browser smoke for the chat in this phase — the side panel context requires user-driven `chrome.action.setSidePanelBehavior` activation that doesn't trivially work via Playwright.

## 9. Open questions

None at writing.
