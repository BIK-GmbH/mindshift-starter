# Path Player UX Overhaul — Design Spec

**Date:** 2026-05-10
**Status:** Drafted, awaiting user review
**Phasing:** Phase 1 ships first (player shell). Phase 2 follows in a separate spec/plan when public-path consumption becomes a priority.

---

## 1. Context & problem

We have a Path concept (ordered, curated sequence of cards with per-step lesson notes, public slug, path-quiz, progress bookmark). The backend is solid — `paths` / `path_cards` / `path_progress` / `path_quiz_attempts` cover the data model.

What is broken today is the **player**. `frontend/src/pages/PathPlayerPage.tsx` simply embeds `CardDetailContent` with `initialTab="summary"` inside a sticky header that carries prev/next. The result, observed in user testing:

- The user clicks "Play" on a path, lands on a YouTube card → sees the **summary text only**. The video player is hidden because in `CardDetailContent` the source-media panel only appears under the *chat* tab and even there is hidden behind a "Show video" toggle.
- Prev / Next sit in the top-right of the header. They are easy to miss while focusing on content. There is no second nav at the bottom of the screen, so once the user has read/scrolled, the only way forward is back to the top.
- The full owner action bar is rendered: Regenerate, Delete, Download, Share, Re-Tag. These are out of place for a learner consuming a course — and outright wrong once paths are consumed by users who are not the card owner.
- The Graph and Podcast-generation tabs are present, both of which drag the learner out of the linear path-flow.

The Path concept is good. The player view doesn't carry it.

## 2. Goals & non-goals

### Goals
- A distinct, course-feeling player view: video-first, lesson note prominent, navigation obvious, no owner-tooling clutter.
- Reuse 80% of card-detail rendering logic (Summary, Transcript, Quiz, Notes, Chat) — do not fork business logic.
- Lay the groundwork so that Phase 2 (per-user overlay for public-path consumers) does not require another refactor.

### Non-goals
- Don't change the standard library card-detail view (`CardDetailContent` in its non-player usages stays unchanged).
- Don't change the path editor (`PathEditPage`), the path quiz page (`PathQuizPage`), or the public path landing page (`PublicPathPage`) beyond what is strictly required to wire the new player in.
- Don't change `path_progress` semantics, slug rules, or quiz scoring.
- Don't touch playlists / podcast episodes (that is a separate, audio-first product).

## 3. Final UX target — vertical stack player

```
┌─────────────────────────────────────────────┐
│ ✕  Path: AI Basics    Step 3/8  [<] [>]     │   sticky top header (slim)
├─────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░  37 %               │   progress bar
├─────────────────────────────────────────────┤
│ LESSON                                      │
│ Watch until 4:32. The model he sketches     │   author lesson note
│ at 2:10 is the one we'll quiz on.           │   (hidden when empty;
│                                             │    truncated >3 lines + "Read more")
├─────────────────────────────────────────────┤
│                                             │
│        ▶  YouTube video (16:9, full width)  │   source media — auto-shown
│                                             │   (PDF reader / URL preview / repo card
│                                             │    for non-YouTube cards)
├─────────────────────────────────────────────┤
│ [Summary] [Transcript] [Quiz] [Notes] [💬]  │   filtered tabs
│ …active tab content scrolls here…           │
│                                             │
├─────────────────────────────────────────────┤   sticky bottom navigation
│ ← Step 2: Intro            Step 4: ML →     │   step titles, not just arrows
└─────────────────────────────────────────────┘
```

### Layout decisions and why
- **Vertical stack, no sidebar.** A 16:9 video deserves the full content width (~800–900 px on desktop). Side-by-side would shrink it to ~550 px and force the eye to jump. The lesson note is short author guidance, not primary content — a banner is the right shape.
- **Lesson note hidden when empty.** Don't render an empty band.
- **Lesson note truncated to ~3 lines + "Read more".** Long notes don't dominate the player; short notes don't bloat.
- **Source media auto-shown.** No "Show video" toggle. The video / PDF reader / URL preview is the centre of the experience.
- **Sticky bottom nav with step titles, not just arrows.** Coursera-pattern. Lets the learner see what's coming and choose deliberately. On the last step the right-hand button morphs into "Take quiz" (we already have this in the top header — we keep that and add the bottom one).
- **Progress bar at top.** Same gradient we use today, but always visible, not buried in the player bar.
- **Mobile = same layout.** Already vertical, scales naturally.

### Tab filtering
| Tab | Status | Rationale |
|---|---|---|
| Summary | ✅ | Quick orientation |
| Transcript | ✅ | Read-along while watching |
| Quiz | ✅ | Per-card self-check; the path-wide quiz still exists at the end |
| Notes | ✅ | Phase 1: owner's own card notes. Phase 2: own overlay if the path is not yours. |
| Chat | ✅ | Course context — "what does he mean by X?" is exactly the right Q here |
| Graph | ❌ | Pulls the learner out of the linear path |
| Podcast | ❌ | Episode-generation is an owner action, not a learner action |

### Owner action bar
Removed entirely from the player view. (Regenerate, Delete, Download, Copy, Share, Re-Tag.) These remain available in the standard library card-detail view.

## 4. Phasing

### Phase 1 — Player shell (this spec, ships first)
Scope: presentation only. Works for **the owner consuming their own path**. No new tables, no new auth surfaces.

### Phase 2 — Per-user overlay (separate spec/plan, follow-up)
Scope: data + auth. Lets non-owners consume a public path with their own private notes/chat layer over the author's cards. Anonymous visitors stay read-only.

Both phases share the same player UI shell — Phase 2 only swaps where the Notes/Chat tabs read and write.

---

## 5. Phase 1 — player shell

### 5.1 New component: `PathPlayerCardView`

A new file `frontend/src/components/PathPlayerCardView.tsx`. Receives:

```ts
interface PathPlayerCardViewProps {
  cardId: string;          // active step's card
  lessonMd: string | null; // author lesson for this step
  // No onBack — the page-level header handles that.
}
```

Internal behaviour:
- Fetches the card (same `api.getCard(cardId)` that `CardDetailContent` uses).
- Renders the source-media panel auto-shown (re-uses existing `CardSourceMedia` component).
- Renders the filtered tab strip (Summary, Transcript, Quiz, Notes, Chat).
- Renders the active tab's content using **extracted** tab renderers (see 5.2).
- Owns local UI state: active tab, transcript-fetched, quiz-fetched, notes-buffer.

What it does **not** do:
- No back/close button (header owns that).
- No action bar.
- No path-level navigation (the page owns that — the component just renders the card).

### 5.2 Refactor: extract tab renderers from `CardDetailContent`

`CardDetailContent.tsx` is 700+ lines with all tab rendering inlined. The Phase 1 refactor extracts each tab's body into its own small, self-contained component under `frontend/src/components/cardTabs/`:

- `SummaryTab.tsx`
- `TranscriptTab.tsx`
- `QuizTab.tsx`
- `NotesTab.tsx` — props include `value`, `onChange`, `onSave`, `saving` so the parent owns persistence
- `ChatTab.tsx` — props include `cardId`, optional `showSourceMedia` flag (default `false`; `CardDetailContent` keeps today's "Show video" toggle by passing `true`, the player passes `false` because the source media is already rendered above the tabs)

Each new component has zero knowledge of where its data comes from at the I/O level — they take props for value + handlers, render markup, and emit events. This is what makes Phase 2 cheap: a `NotesTab` does not care whether the parent persisted the value via `api.updateNotes(cardId, …)` or `api.updatePathCardNotes(pathId, cardId, …)`.

After extraction, `CardDetailContent` continues to compose these tabs in its own way (with the action bar, the share modal, the graph tab, the podcast tab, etc.). `PathPlayerCardView` composes a strict subset.

### 5.3 Page-level changes: `PathPlayerPage`

```
┌── Header (sticky) ─────────────────────────────┐
│ ← back-to-editor | "Path: <title>"   step N/T  │
│ progress bar (full width, 2 px tall)            │
└────────────────────────────────────────────────┘
│
│  PathPlayerCardView (the new component)
│
└── Footer (sticky) ─────────────────────────────┐
   ← Step N-1: <prev title>      Step N+1: <next title> →
   (on last step, right side becomes "Take quiz" CTA)
```

Behavioural notes:
- Keyboard nav (arrow keys) stays.
- `path_progress` update on step change stays.
- The current top-right prev/next buttons stay (so power users don't have to scroll). The bottom footer is the *additional* primary nav.

### 5.4 Edge cases — Phase 1
- **Lesson note empty** → don't render the lesson band.
- **Lesson note longer than 3 lines** → truncate with `line-clamp-3` and a "Read more" toggle.
- **Card source is not video** → `CardSourceMedia` already handles PDF reader, URL preview, generic source link. We render whatever it gives us in the same slot.
- **Card has no source media at all** (rare; e.g. notes-only card) → skip the source slot, content rises to fill.
- **Card still ingesting (`status != "completed"`)** → the existing 2.5 s polling in the card-fetch effect surfaces it; tabs show their existing in-progress placeholders.
- **Path has 0 cards** → already handled by current page; we keep the empty state.
- **Last step** → top-right header CTA already swaps to "Take quiz". Bottom footer right swaps too.
- **First step** → bottom footer left disabled (greyed).

### 5.5 What does NOT change in Phase 1
- Backend: nothing.
- Models: nothing.
- API surface: nothing.
- `CardDetailContent` consumers (library card-detail page, embedded chat panel, etc.) keep their full feature set including the action bar.
- `PublicPathPage` (the read-only public view) keeps its current behaviour.
- `PathEditPage`, `PathQuizPage`, `PathsPage` unchanged.

### 5.6 Testing strategy — Phase 1
- Manual UX walkthrough (`./scripts/start.sh`):
  1. Open an own path with a YouTube step → video visible immediately, prev/next obvious top and bottom.
  2. Step with lesson note → note visible above video, truncates if long.
  3. Step with PDF source → PDF reader renders in the source slot.
  4. Last step → right-hand CTA reads "Take quiz".
  5. Tab strip shows Summary/Transcript/Quiz/Notes/Chat — no Graph, no Podcast.
  6. No Regenerate / Delete / Share buttons visible.
- Automated: a single Playwright test (`frontend-test` skill) that opens a seeded path, verifies the video iframe is in the DOM on first paint, walks Step 1 → Step 2 via the bottom-nav button, and confirms `path_progress.current_position` advances.
- Type-check: `npm run typecheck` clean.
- No new unit tests — extracted tab components are pure presentational and their behaviour is exercised by both `CardDetailContent` (existing usage) and `PathPlayerCardView` (new usage).

---

## 6. Phase 2 — per-user overlay (sketch only; full spec follows later)

### 6.1 Architecture choice: overlay, not clone
A clone model (duplicating the author's cards into each consumer's library when they start a path) would inflate storage linearly with subscriber count and create a "did the original change?" drift problem. We pick an **overlay** model: the path-author's cards stay the canonical source; per-(user, path, card) layers store the consumer's own private state.

### 6.2 New tables
- `path_card_notes(user_id, path_id, card_id, notes_md, updated_at)` — per-user notes scoped to a card *as encountered inside a specific path*.
- `path_card_chat_messages(user_id, path_id, card_id, role, content, created_at)` — per-user chat history; today the chat-with-card endpoint is stateless on the server (the client sends history). Phase 2 introduces server-side persistence so the conversation survives a refresh and a session.

### 6.3 New endpoints
- `GET/PUT /api/paths/{path_id}/cards/{card_id}/notes`
- `GET/POST/DELETE /api/paths/{path_id}/cards/{card_id}/chat`

The `_accessible_path` guard already supports owner + public-via-slug access.

### 6.4 Auth gates
- **Anonymous visitor** of a public path → Notes and Chat tabs hidden. Tab strip becomes Summary / Transcript / Quiz only. A subtle "Sign in to take notes" CTA replaces the missing tabs in the empty state.
- **Logged-in user, not the path owner** → Notes and Chat tabs read/write the overlay tables for `(current_user.id, path.id, card.id)`.
- **Logged-in path owner** → Notes still goes to `cards.notes_md` (their canonical card). Chat behaves like today. We do **not** dual-write.

### 6.5 Frontend wiring
The extracted `NotesTab` and `ChatTab` from Phase 1 already accept value + handler props. The `PathPlayerCardView` decides at runtime which API to call based on whether `current_user.id === path.user_id`. No new tab components; only a new owner of the data.

### 6.6 Open questions parked for Phase 2 spec
- Should the path-quiz score also become per-user-per-path-attempt for non-owners? (Probably yes — `path_quiz_attempts` already keys on `user_id`, so this is mostly a permissions question.)
- Should non-owners' progress on a public path live in the same `path_progress` table? (Probably yes — it already keys on `(user_id, path_id)` and the table allows it.)
- Should the public-path-quiz be available without login? (Open — could gate behind login to drive sign-ups.)

---

## 7. Phasing & cut-line

| Item | Phase 1 | Phase 2 |
|---|---|---|
| New `PathPlayerCardView` component | ✅ | — |
| Extract tab renderers from `CardDetailContent` | ✅ | — |
| Sticky bottom nav with step titles | ✅ | — |
| Lesson note truncate-with-expand | ✅ | — |
| Owner action bar removed in player | ✅ | — |
| Auto-show source media | ✅ | — |
| Filter Graph & Podcast tabs out | ✅ | — |
| `path_card_notes` table + endpoints | — | ✅ |
| `path_card_chat_messages` table + endpoints | — | ✅ |
| Anonymous-public-path tab gating | — | ✅ |
| Owner-vs-consumer routing inside `PathPlayerCardView` | — | ✅ |

Phase 1 alone solves the user-reported pain ("clicked play, got video, couldn't navigate, couldn't watch"). Phase 2 is the strategic follow-up that enables paths-as-a-shareable-product.

## 8. Done criteria

### Phase 1
- All Phase-1 cells in §7 ticked.
- Manual walkthrough (§5.6) passes on a seeded user with a multi-step path that mixes YouTube, article, and PDF sources.
- Type-check clean. Existing library card-detail flows untouched (sanity-check the library still renders the action bar).
- One Playwright happy-path test green.

### Phase 2 (deferred — own done-criteria once specced)

## 9. Open questions for user review

None at the time of writing. Phase boundaries are clear. Proceed to implementation plan for Phase 1 once user approves.
