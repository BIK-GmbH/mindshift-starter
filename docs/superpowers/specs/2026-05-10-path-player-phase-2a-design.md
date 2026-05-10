# Path Player Phase 2a — Public Path Read-Mode

**Date:** 2026-05-10
**Status:** Drafted, awaiting user review
**Predecessor:** `2026-05-10-path-player-ux-design.md` (Phase 1, shipped) and `2026-05-10-path-player-phase-1.md` (Phase 1 plan, shipped).
**Successor (parked):** Phase 2b — per-user notes/chat overlay (this spec replaces the original §6 sketch with a sharper Phase 2a; 2b is summarised at the bottom).

---

## 1. Context & problem

After Phase 1, the path player is a polished course-reader for the **owner of the path**. Public paths exist (`/u/<username>/path/<slug>`) but the consumption story is anaemic:

- `PublicPathPage` shows the path metadata + a list of card titles + thumbnails + concise summaries. That's it.
- Clicking through to a step doesn't really do anything for a non-owner — there is no public player route, and the owner's player calls `api.getCard(cardId)` which the backend rejects for non-owners.
- A consumer can see the *fact* that a card exists in the path, but not its detailed summary, transcript, quiz, or source media (YouTube embed, URL preview, etc.).
- Logged-in users browsing someone else's public path have no way to track their own progress or quiz attempts, even though `path_progress` and `path_quiz_attempts` are already keyed on `(user_id, path_id)` and would Just Work if the access checks let them.

Phase 2a closes this gap: **a public path becomes a real, walkable course** for anyone with the link, with logged-in users additionally getting their own progress/quiz history.

## 2. Goals

- Anonymous and logged-in non-owners can open a public path and walk through it step-by-step with full content visible.
- The player UI from Phase 1 is reused — same sticky header, lesson note, mini-player, sticky bottom nav.
- Logged-in non-owners get personal **progress bookmark** and **quiz attempt history** (free wins; the data model already supports them).
- Zero new database tables. Phase 2a is access-control + endpoint-shape work.

## 3. Non-goals

- **No notes overlay** for non-owners (that is Phase 2b).
- **No chat tab** for non-owners (also 2b — chat with cards costs OpenAI tokens; we'll gate it behind ownership-or-overlay).
- **No anonymous progress / quiz tracking.** Anonymous = read-only consumption. If you want your progress saved, sign in.
- **No clone of cards into the consumer's library.** Confirmed-overlay model — already decided in §6 of the predecessor spec.
- **No path-quiz access for anonymous.** Quiz aggregates require `_accessible_path` which works for non-owners; but `record_quiz_attempt` writes to `path_quiz_attempts` which needs a `user_id`. Anonymous can browse the questions but cannot submit a scored attempt. (Logged-in non-owners can.)

## 4. Exposure matrix

| Feature | Anonymous | Logged-in non-owner | Owner (today) |
|---|---|---|---|
| Title, lesson note, all summaries | ✅ | ✅ | ✅ |
| Transcript (full text + segments + jump-to-YouTube) | ✅ | ✅ | ✅ |
| Quiz questions (read + reveal) | ✅ | ✅ | ✅ |
| YouTube embed | ✅ | ✅ | ✅ |
| URL / GitHub preview | ✅ | ✅ | ✅ |
| PDF reader on source media | ✅ | ✅ | ✅ |
| Mini-player on scroll (Phase 1 sticky-on-scroll) | ✅ | ✅ | ✅ |
| Step navigation (←/→, arrow keys, sticky bottom nav) | ✅ | ✅ | ✅ |
| Progress bookmark (resume where left off) | ❌ no account | ✅ | ✅ |
| Quiz attempts saved (best score, history) | ❌ | ✅ | ✅ |
| Path-quiz aggregate page | ✅ read-only | ✅ writes attempt | ✅ |
| Notes tab | ❌ hidden | ❌ hidden (Phase 2b) | ✅ |
| Chat tab | ❌ hidden | ❌ hidden (Phase 2b) | ✅ |
| Owner action bar (Regenerate / Delete / Share / Re-Tag) | ❌ | ❌ | ✅ |

## 5. Backend changes

### 5.1 New unauthenticated public endpoints
All under `public_router` (`/api/public/paths/{username}/{slug}`):

- `GET /cards/{card_id}` — returns the full `CardOut` shape that the player needs: `id, title, source_type, status, external_id, source_url, thumbnail_url, concise_summary_md, detailed_summary_md, key_takeaways_json, is_public, created_at, ...`. NOT included: `notes_md` (owner's private notes), tags (overkill for the consumer view), `entities` (overkill). The handler verifies `card_id` is part of the public path.
- `GET /cards/{card_id}/transcript` — returns the transcript shape `TranscriptOut` (text + segments + language + provider).
- `GET /cards/{card_id}/quiz` — returns `QuizQuestion[]`.

All three handlers share a small helper `_load_public_card_in_path(db, username, slug, card_id) -> Card`:
1. Look up user by `username` + `public_profile.is_(True)`.
2. Look up path by `(user_id, slug, is_public.is_(True))`.
3. Confirm a `path_cards` row exists for `(path.id, card_id)`.
4. Return the card. 404 if any step fails.

### 5.2 Logged-in non-owner endpoints
**No new endpoints.** The existing `/api/paths/{path_id}/...` family already uses `_accessible_path` which allows non-owners on public paths. Verified usages:

- `GET /paths/{id}/progress`, `POST /paths/{id}/progress` — non-owner writes a row keyed on their own `user_id` thanks to the existing unique constraint `(user_id, path_id)`. Already works.
- `GET /paths/{id}/quiz`, `POST /paths/{id}/quiz/attempts`, `GET /paths/{id}/quiz/attempts`, `GET /paths/{id}/quiz/stats` — same pattern. All accept any `current_user` who can `_accessible_path`.

The frontend just needs to know the `path_id` once it has the public path's `slug` — it gets that from the `GET /public/paths/{u}/{s}` response (already returns `id`? check; if not, add it to `PublicPathOut`).

### 5.3 PDF file access
The existing `GET /api/files/{file_id}` enforces owner-only access (`file.user_id != current_user.id → 404`), so even a logged-in non-owner cannot fetch PDFs of someone else's path. Phase 2a adds:

- `GET /api/public/paths/{username}/{slug}/cards/{card_id}/file` — streams the original blob (PDF, etc.) with the same access guard `_load_public_card_in_path` uses for the other public endpoints. Cache-Control: `public, max-age=86400`. No auth required.

The frontend's `CardSourceMedia` for PDF cards in public mode points at this URL instead of the auth-protected `/api/files/{id}` route. Anonymous and logged-in non-owners use the same endpoint.

### 5.4 What is NOT changed in Phase 2a
- `chat_card`: remains owner-only.
- `update_notes`: remains owner-only.
- The Card schema: unchanged.
- DB migrations: zero new tables, zero new columns.

## 6. Frontend changes

### 6.1 Routing
Three new routes:
- `/u/:username/path/:slug/play` → opens the public player at step 1
- `/u/:username/path/:slug/play/:step` → opens at the given step (URL-deep-linkable)
- `/u/:username/path/:slug/quiz` → public path-quiz page (read or write depending on auth)

`PublicPathPage` keeps existing route `/u/:username/path/:slug` as the landing page, plus a primary CTA "Start path" → the new `play` route.

### 6.2 New API methods
On `frontend/src/lib/api.ts`:
- `getPublicCard(username, slug, cardId): Promise<Card>`
- `getPublicCardTranscript(username, slug, cardId): Promise<TranscriptOut>`
- `getPublicCardQuiz(username, slug, cardId): Promise<QuizQuestion[]>`

These mirror the owner versions but hit the public endpoints. They send no `Authorization` header (anonymous-safe). For logged-in users, they also work without ownership check.

### 6.3 Player composition
We reuse `PathPlayerPage` + `PathPlayerCardView` via a single new prop on each: `mode: "owner" | "public"`. The mode threads down two decisions:
1. **Which API to call** for `getCard` / `getTranscript` / `getQuiz` — owner endpoints in owner mode; public endpoints in public mode (passing `username` + `slug` from the route).
2. **Which tabs to render** — Summary, Transcript, Quiz always; Notes + Chat only in owner mode.

`PathPlayerCardView` accepts `mode` and either:
- (mode="owner") `cardId: string` (today's behaviour), or
- (mode="public") `username: string`, `slug: string`, `cardId: string`.

The component still owns its tab-state and source-media rendering. The action-bar removal from Phase 1 means there's nothing owner-specific to strip in the header — the player already has no owner UI.

For PDF cards in public mode, `CardSourceMedia` either renders today's PDF reader (logged-in path) or a placeholder card with "Sign in to view the original PDF" + a button linking to the login page (anonymous path).

### 6.4 Progress + quiz hooks
- In **public mode + anonymous**: progress save and quiz-attempt POST are skipped client-side. Step navigation reads `?step=` only.
- In **public mode + logged-in**: progress save and quiz-attempt POST go through the existing path endpoints with the logged-in user's JWT. The same `api.updatePathProgress(pathId, position)` works because `_accessible_path` admits non-owners on public paths.

The detection is `localStorage.getItem("mindshift.token")` — if present, assume logged-in and call the auth endpoint; if absent, skip.

### 6.5 PublicPathPage CTA
Add a primary "Start path" button to `PublicPathPage` linking to `/u/:user/path/:slug/play`. Keep the rest of the page as-is (landing/SEO/overview). Public-path consumers click into the player from there.

## 7. Edge cases

- **Anonymous user clicks Notes/Chat tab** → tabs are not rendered. No login prompt in the player itself; the user can sign in via the global header.
- **Anonymous user lands on the path-quiz page** → questions render in preview mode. The Submit button is replaced by a banner "Sign in to save your score" linking to the login page. No localStorage fallback (keeps the data flow simple — sign-in is the path to persistence).
- **Path made private while a consumer is reading** → next API call 404s; the player shows the existing not-found state.
- **Card deleted from path while consumer is on that step** → step list gets shorter on next fetch; URL `?step=N` clamps to valid range.
- **Logged-in non-owner who bookmarks a step then goes private→public again** → their `path_progress` row persists across visibility changes (it's per-(user, path), not gated on visibility). Acceptable.
- **YouTube embed inside a public path** — `CardSourceMedia` builds the iframe from the YouTube ID; the embed URL is public. Confirm in implementation that the iframe origin is `youtube-nocookie.com` to avoid third-party cookie warnings on anonymous visits.

## 8. Testing

Manual:
1. Sign out, open `/u/<seeded-user>/path/<seeded-slug>` → CTA visible. Click → player opens. All tabs visible *except* Notes + Chat. Source media renders for YouTube and URL/GitHub. PDF shows the placeholder.
2. Walk through 2 steps via bottom-nav. Refresh → stays on the chosen step (URL preserves it).
3. Try the path-quiz from anonymous → questions render, submit shows "Sign in to save" hint.
4. Sign in as a non-owner. Reload the same path → bottom-nav resumes from step 1 (no prior progress yet). Walk a step, refresh → URL has the step. Re-open the path from the landing page → resumes at the visited step (per `path_progress`).
5. Run path-quiz → submit → score saved. Re-run → quiz-stats endpoint returns 1 attempt.
6. Sign in as owner of the same path → all tabs back, action bar visible, progress is the OWNER's progress (separate from consumer's).
7. Verify in DB: two `path_progress` rows for the same path, one per user. Same for `path_quiz_attempts`.

Automated:
- One Playwright test exercising the anonymous read-mode end-to-end (already deferred in Phase 1 — same tooling decision applies here).
- Backend pytest for the three new public endpoints: 200 with correct shape, 404 for non-public paths, 404 for cards not in the path.

## 9. What does NOT need to be done

- DB migrations: none.
- New tables: none.
- Schema changes on existing tables: none.
- New auth flows: none. (Existing JWT works for logged-in non-owners; anonymous calls don't need a token.)
- `chat_card`, `update_notes`, owner action bar — untouched.

## 10. Phase 2b summary (parked)

When 2a is live and we want consumers to take notes / chat with cards:

- `path_card_notes(user_id, path_id, card_id, notes_md, updated_at)` — per-(user, path, card) markdown notes overlay.
- Extend `chat_sessions` with optional `path_id` so a non-owner gets a chat thread per (user, path, card) without colliding with the owner's card-chats.
- Loosen `chat_card` access to "ownership OR (logged-in and card is in a public path you can access)" — gated on a `?path_id=…` query param so the API has explicit context.
- Frontend: in public mode + logged-in, render Notes and Chat tabs again, with their data sourced from the overlay tables.
- Anonymous: still no Notes/Chat (would need either localStorage or an account).
- Migration: add the new table + column. Backfill not required (overlay is per-user; new users start empty).

This is at minimum a separate spec + plan. Don't ship 2b until 2a has been used and we know consumers want notes.

## 11. Open questions for user review

None at the time of writing. PDF access via a new public file endpoint, anonymous quiz preview-only with sign-in banner — both decided inline above.

If anything in §4 (exposure matrix), §5 (backend changes), or §6 (frontend changes) feels off, flag it now. Otherwise the next step is the implementation plan.
