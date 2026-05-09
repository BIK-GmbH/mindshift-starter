# Mindshift Roadmap

Implementation order agreed 2026-05-09. Each phase ships independently
and is committable on its own.

## Phase 1 — PWA + Web Share Target

Make Mindshift a Progressive Web App so the iPhone/Android browser can
"add to home screen" and the OS share sheet routes URLs into Mindshift.

- `manifest.webmanifest` with icons (192, 512), theme color, display
  standalone, and a `share_target` action.
- Apple-touch-icon for iOS pinning.
- React route `/share-target?url=...&title=...&text=...` that calls
  `/api/cards/from-url` and navigates to the resulting card.
- Theme-color meta + viewport tweaks for safe-area on iOS.
- (Optional v2: service worker for offline reading and push for spaced
  repetition — defer until the rest works.)

Why first: solves "mobile app" without an app-store build and matches
the way users already capture content (share sheet from YouTube, Safari,
podcast apps). One day of work, biggest UX leap.

## Phase 2 — Audio upload + Whisper transcription

New source type for voice memos / meeting recordings / coaching calls.

- Frontend: file drop in AddContentModal accepting `audio/*` (mp3, m4a,
  wav, webm). Reuse the existing PDF upload path mechanically.
- Backend: `POST /api/cards/from-audio`, persists original via storage
  service, kicks off `process_audio_card`. Transcribes via OpenAI
  Whisper API, then runs the existing summarization pipeline.
- Source row: `source_type="audio"`, metadata includes duration + size.
- Reingest support; SOURCE_ICONS extended; LibraryPage filter pill.

Why second: leverages the existing card pipeline, opens an entirely new
input modality, ~half a day of work.

## Phase 4 — Browser extension polish

A real "Save to Mindshift" extension — there is already CORS allowance
for `chrome-extension://` so the foundation is partial. Audit current
state, finish the popup UI (paste URL or auto-detect current tab),
auth via shared JWT, success toast, link back to the new card.

## Phase 6 — RSS feed subscriptions

Subscribe to RSS/Atom feeds; cron pulls new entries and runs them
through the article pipeline. Feeds are first-class entities (rename,
disable, delete). New "Feeds" sidebar entry. Turns Mindshift into an
AI-augmented reader.

## Phase 8 — Learning paths / mini-courses

Cards bundled into ordered "paths" with progress tracking and a path-wide
quiz mode. Public paths discoverable on the user's profile. This is the
biggest item — design before building.

---

Items considered but not on the agreed path (revisit later): command
palette (Cmd+K), email-forward ingestion, screen recording, daily/weekly
digest email, social following layer, native mobile builds.
