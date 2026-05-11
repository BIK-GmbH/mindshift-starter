# Embed Page + Side Panel Architecture

Last updated: 2026-05-11.

This doc explains how the Chrome side panel, the embedded card view (`/embed/cards/<id>`), and the YouTube-pill bridge fit together. If you touch any of these, re-read first — there are three distinct execution contexts that talk to each other via two different message channels.

## The three execution contexts

```
┌───────────────────────────────────────────────────────────────┐
│ Chrome side panel (chrome-extension://<id>/sidepanel.html)    │
│                                                               │
│   sidepanel.js                                                │
│     • reads chrome.storage.local (apiUrl, token)              │
│     • detects current tab URL → /api/cards/by-source-url      │
│     • renders Card pane with <iframe src="…/embed/cards/X">   │
│                                                               │
│   ┌─────────────────────────────────────────────────────────┐ │
│   │ Iframe @ web-app origin (localhost:5173 / production)   │ │
│   │                                                         │ │
│   │   EmbedCardPage.tsx                                     │ │
│   │     • compact header (title + tags left, thumb right)   │ │
│   │     • tab strip (Summary / Transcript / Notes / Chat)   │ │
│   │     • only the tab content scrolls                      │ │
│   │     • timestamp pills in summary/transcript text        │ │
│   └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│ A YouTube tab the user has open                               │
│                                                               │
│   extension/content/youtube.js (content script)               │
│     • mounts the in-page Save button                          │
│     • listens for cardSaved broadcasts                        │
│     • listens for mindshift:seekVideo messages                │
└───────────────────────────────────────────────────────────────┘
```

Three sandboxed worlds, one extension. They can't share state directly — they pass messages.

## The layout decision: fixed header, fixed tabs, scroll only the content

The embed page used to wrap everything in one `overflow-y-auto` container — hero, tags, sticky-tab-strip, tab content. Switching tabs caused the hero to re-appear because tab content height changed between tabs (chat: short, summary: tall via `min-h-[120vh]`), so the browser auto-clamped `scrollTop` back down.

Today's structure (since commit `e759cc6` 2026-05-11):

```
<embed-shell flex h-full flex-col overflow-hidden>
  <embed-bar />                ← flex-shrink-0 — fixed top, action buttons
  <compact-header />           ← flex-shrink-0 — title + tags + small thumb
  <TabStrip />                 ← flex-shrink-0 — fixed below header
  <div flex-1 min-h-0 overflow-y-auto>
    {active tab content}       ← only this scrolls
  </div>
  <bottom-CTA />               ← flex-shrink-0 — fixed bottom
</embed-shell>
```

No more sticky positioning inside a scroll container. No more `min-h-[120vh]` tricks. Switching tabs is now a content-only swap; the chrome stays put.

### Action buttons in the embed-bar

Five items, left to right (post-cleanup, commit `03fa3b8`):

| Item | Icon | Action |
|---|---|---|
| Open in Mindshift | `ExternalLink` | New tab → web app's full card detail at `/cards/{id}` |
| Copy link | `Link` (lucide-react, **not** an emoji) | Copies the share link to clipboard, button shows ✓ for 1.5s |
| Search library | `Search` | Toggles the in-embed search strip |
| Language picker | `CardLanguagePicker` ("Original ▾") | Switch translations / mark a card for re-translate. Only shown when card is `completed`. |
| Theme toggle | `Sun` / `Moon` | Flips the embed between dark and light theme via the `.light` class on `documentElement` |

Things deliberately removed: a separate text "Open" button (duplicated the Maximize2 pop-out), the `🔗` emoji copy-link icon (style mismatch with SVG icons), the `youtube` source-pill (pure decoration).

## The timestamp-pill bridge

This is where the three contexts talk.

### Pattern overview

```
(1) User clicks pill in EmbedCardPage (iframe inside side panel)
       │
       │ window.parent.postMessage({type: "mindshift:seekVideo", videoId, seconds})
       ▼
(2) sidepanel.js receives via window.addEventListener("message", ...)
       │
       │ chrome.tabs.query → find the YouTube tab playing this video
       │ chrome.tabs.update(focus) + chrome.tabs.sendMessage
       ▼
(3) extension/content/youtube.js receives via chrome.runtime.onMessage
       │
       │ matches videoId vs its own page videoId, then:
       │ video.currentTime = seconds; video.play();
       ▼
   Video on YouTube tab seeks to the timestamp.
```

### Why three contexts and not direct calls?

- The iframe at the web-app origin **cannot** access `chrome.*` APIs. It's not part of the extension. So it can't talk to a YouTube content script directly. The only escape it has is `window.parent.postMessage`.
- The side panel **can** access `chrome.tabs.*`. It bridges the postMessage to the right YouTube tab.
- The YouTube content script **owns** the page's `<video>` element. Only it can call `currentTime = …`.

### Code locations

- **Producer (embed iframe)** — `frontend/src/pages/EmbedCardPage.tsx`, around the `onTimestampClick` `useCallback`. Detects iframe via `window.parent !== window`. In iframe: posts to parent. Standalone (popped out): falls back to `window.open` opening YouTube at the timestamp.
- **Bridge (side panel)** — `extension/sidepanel.js`, the `window.addEventListener("message", ...)` block near the bottom. Filters for `type === "mindshift:seekVideo"`, picks the matching YouTube tab if any (by parsing `?v=` from the tab URL), otherwise opens a brand-new YouTube tab at the timestamp. Either way the user always sees an action — no silent fail.
- **Consumer (YouTube tab)** — `extension/content/youtube.js`, a dedicated `chrome.runtime.onMessage.addListener` for `mindshift:seekVideo`. Uses the existing `videoIdFromUrl(window.location.href)` helper to confirm the message is for this video before seeking.

### Diagnostic logging

All three hops emit `console.warn("[mindshift …] …")` lines (commit `03fa3b8`) so we can trace where a click is lost. To debug a bridge issue you need to look at **three consoles**:

1. The **embed iframe** console — right-click in the side panel → Inspect → in DevTools' frame dropdown, select the `embed/cards/...` frame. Expect: `[mindshift] pill click — videoId: …, isInIframe: true` + `posted to parent`.
2. The **side panel** console — same Inspect, default frame. Expect: `[mindshift sidepanel] message received: ...` + `matching tab found` or `opening new`.
3. The **YouTube tab** console — DevTools on the YouTube tab itself. Expect: `[mindshift youtube] seek-msg received` + `seeked to N`.

If hop (1) doesn't appear: the click is not being delegated to `onTimestampClick`. Check that `MarkdownView`'s container ref attached and the useEffect listener is wired. If (1) appears but (2) doesn't: the iframe's `window.parent.postMessage` isn't reaching the side panel — check that the embed is actually inside the side-panel iframe (`isInIframe: true`) and that the side panel's listener was registered before the click. If (1+2) appear but (3) doesn't: `chrome.tabs.sendMessage` rejected — usually means the content script isn't loaded in that tab. The error message lands in (2) at `send-error: ...`.

## Compact-header layout

The hero used to be a full-width aspect-video image at the top of a scrollable area, scrolling away as the user scrolled into content. The user's feedback (paraphrased): "it feels like the whole panel scrolls". Solution: compress the hero into a small persistent badge next to the title.

```
┌────────────────────────────────────────────┬───────────┐
│ Card title here, can wrap                  │   ┌────┐  │
│                                            │   │img │  │
│ #tag #tag #tag (+)                         │   └────┘  │
└────────────────────────────────────────────┴───────────┘
```

Thumbnail: `<img src={card.thumbnail_url}>` at ~80×80 or 96×54 on the right, with proper aspect ratio for the source type (video = 16:9, article cover = square). No thumbnail → no image, title and tags fill the row.

The compact header is `flex-shrink-0` directly under the embed-bar. It never scrolls.

## The chat tab

Lives in the same scrollable content area as Summary/Transcript/Notes. Uses `ChatTab` with `fitParent` so the chat fills the tab content area, with the message history on top (scrolling internally) and the composer pinned to the bottom of the chat block. Voice + mic button come from the existing `VoiceRecordButton` React component (no JS port needed because the embed is React).

There used to be a "maximize chat" toggle (commit `786f84b`) that hid the hero for a fullscreen chat. With the fixed-header layout that's not needed — the hero is already small.

## When you change anything in this stack

1. If you change the **embed iframe's** producer code (`onTimestampClick`, `MarkdownView`): test that pills still delegate correctly inside the iframe AND fall back to opening YouTube in standalone (no parent).
2. If you change **sidepanel.js**: test in the actual Chrome side panel — `chrome.tabs.*` only works there, not in a regular tab.
3. If you change **youtube.js**: bump `manifest.json` version so Chrome reloads the content script. Reload the extension in `chrome://extensions` AND hard-reload any open YouTube tab — content scripts don't auto-update on extension reload.
4. Don't introduce a fourth message channel between these three contexts — keep the postMessage / chrome.tabs.sendMessage split. Any additional channels means more debug surfaces.
