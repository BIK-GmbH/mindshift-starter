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

## ⏭ Phase 2 — Browser extension polish *(next)*

A real "Save to Mindshift" extension. CORS already allows
`chrome-extension://` origins so the foundation is partial. Audit the
current state, finish the popup UI (paste URL or auto-detect current
tab), auth via the same JWT the web app uses, success toast, link back
to the new card. Same auto-detect path as `/api/cards/from-url` so the
extension immediately covers YouTube and GitHub.

## Phase 3 — RSS feed subscriptions

Subscribe to RSS/Atom feeds. Cron pulls new entries through the
existing article pipeline. Feeds become first-class entities (rename,
disable, delete). New "Feeds" sidebar entry. Turns Mindshift into an
AI-augmented reader.

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
