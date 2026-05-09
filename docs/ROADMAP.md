# Mindshift Roadmap

Implementation order — phase 1 + 1.5 are shipped. Audio/Whisper was
moved to the back of the queue: the user will provide a tested
recording + chunking implementation later, so a half-baked first cut
would just be wasted work.

## ✅ Phase 1 — PWA + Web Share Target *(shipped 2026-05-09)*

Mindshift installs to the iOS/Android home screen via `manifest.webmanifest`,
and the OS share sheet routes URLs to a `/share-target` route that
forwards to the existing `/api/cards/from-url` endpoint. JWT lives in
localStorage so the share flow runs silent after the first login.

## ✅ Phase 1.5 — Mobile polish *(shipped 2026-05-09)*

Mobile strategy decision: only the **library** (browse + search + tags
drawer) plus the **PWA share-target** are first-class mobile features.
Everything else is desktop-first; on `<md` viewports the graph, full
chat workspace, review dashboard and podcast studio show a small
amber "best on desktop" banner above their header.

Implementation:
- Tags sidebar slides in as a drawer on `<md` (hamburger button in the
  library header, backdrop click closes, URL change auto-dismisses).
- `@media (hover: none)` lifts every `opacity-0 group-hover:opacity-100`
  button to 50% opacity so per-tag actions are tappable on touch.
- Shared `MobileDesktopHint` component on graph / chat / review /
  podcasts pages.

See `docs/MOBILE.md` for the complete mobile contract.

## ✅ Phase 2 — Browser extension polish *(shipped 2026-05-09)*

The unpacked extension at `extension/` is now coherent with the rest
of the stack. `/api/cards/from-url` learned YouTube auto-detection
(it already had GitHub), so the popup talks to a single endpoint and
the backend picks the right pipeline. After saving, the toast shows
the card's title and a clickable "open card" link that fires
`chrome.tabs.create` and closes the popup. Token rotation is handled:
401/403 responses bounce the popup back to the settings pane with an
explanation. Icons regenerated to match the PWA M-glyph.

Side-effect: the PWA share-target route now ingests YouTube URLs
correctly too — previously they were treated as plain articles.

## ✅ Phase 3 — RSS feed subscriptions *(shipped 2026-05-09)*

`feeds` table + `services/feed_scheduler.py` (APScheduler, 30 min
default interval) + `services/feeds.py` (feedparser, conditional GET,
dedup, fail-soft). REST CRUD + `POST /feeds/{id}/refresh`. New
`/feeds` page in the rail with add / rename / pause / refresh / delete.
Per-feed counter + last-sync timestamp + last-error chip.

Caps: 25 new items per poll per feed. Errors are persisted on the row
so the user can diagnose without server logs. New subscriptions are
polled immediately via BackgroundTasks so cards appear in seconds.

## Phase 4 — Learning paths / mini-courses

Cards bundled into ordered "paths" with progress tracking and a path-
wide quiz mode. Public paths discoverable on the user's profile.
Biggest item — design before building.

## Phase 5 — Audio upload + Whisper *(deferred)*

Was originally phase 2. Moved here because the user has a tested
recording + chunking implementation he wants to drop in once the
other items are done — building it from scratch first would be wasted
work. Will cover both pre-recorded audio file uploads **and** in-app
voice recording with streaming chunked transcription.

---

Items considered but not on the agreed path (revisit later): Cmd+K
command palette, email-forward ingestion, screen recording, daily/
weekly digest emails, social following layer, native mobile builds.
