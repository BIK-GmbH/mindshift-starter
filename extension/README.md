# Mindshift browser extension

Add the current page or your entire bookmarks tree to your Mindshift
knowledge base from any Chromium-based browser (Chrome, Edge, Brave, …)
or Firefox. The popup talks directly to your running Mindshift backend
— there is no third party in the path.

## Install (unpacked)

### Chrome / Edge / Brave

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick this `extension/` folder.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json`.

> Note: Firefox treats temporary add-ons as session-scoped — you'll need
> to reload it per session, or sign and publish for a permanent install.

## Connect

The popup's first run shows a settings pane:

- **API URL** — `http://localhost:8001` for local dev, otherwise your
  hosted Mindshift instance.
- **Token** — open Mindshift in your browser → gear icon (lower-left)
  → **API & Extension** → **Reveal token** → copy.

The token is a long-lived JWT (1 year). It's stored only in
`chrome.storage.local` of this extension.

## Use

- **Add this page** — the active tab's URL is sent to
  `POST /api/cards/from-url`. The backend auto-detects YouTube and
  GitHub URLs and routes them to the right ingestion pipeline; the
  extension does not branch by host. The success toast shows the
  card's title and an **open card** link that takes you straight to
  the new card detail page.
- **Import all bookmarks** — reads `chrome.bookmarks` recursively,
  collects http(s) URLs, and posts them as a Netscape-format file to
  the existing `POST /api/import/bookmarks` endpoint (dedup +
  500-card cap, server-side).

## When the token expires

Tokens are long-lived (1 year by default) but you can rotate them in
Mindshift any time. If the rotated token hasn't reached the extension
yet, the popup auto-bounces to the settings pane with an explanation
the next time you click Add — paste the new token and you're back.

## Permissions explained

- `bookmarks` — required for the bulk import button.
- `activeTab` + `tabs` — needed to read the current tab's URL/title.
- `storage` — store the API URL and token between popup opens.
- `host_permissions` — needed so the popup can call your Mindshift API.

The extension makes **no** outbound calls except to the API URL you
configure.
