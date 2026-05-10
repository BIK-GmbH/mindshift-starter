# Extension — Phase 3: Side-panel inneres

Four additions that turn the side panel from a viewer into a place
where the user can actually *do something* with the card. All purely
frontend in `EmbedCardPage.tsx` (paths workstream owns
`CardDetailContent.tsx` and `cardTabs/*` — phase 3 stays out of those).

## Block G — Inline search bar

**Goal:** find any saved card without leaving the panel.

### G1. UI in EmbedCardPage mini-bar
A small search icon button next to the language picker. Click → swap
the mini-bar into a search-input mode (escape / blur reverts). Type
≥ 2 chars → debounced `api.searchKeyword()` call → dropdown of hits
under the bar. Click a hit → `useNavigate` to `/embed/cards/<id>` so
the iframe re-mounts on the chosen card.

### G2. Behaviour notes
- Backend `searchKeyword` already exists (`/api/search?q=…`), and
  returns up to 20 hits with snippets. No backend change.
- Debounce 250 ms — keystrokes on small input shouldn't slam the API.
- Close on outside click, on `Escape`, on selection.

## Block H — Related-cards strip

**Goal:** when the user lands on a card, surface the 3-5 most-related
cards from the library at the bottom of the summary.

### H1. UI
At the end of `SummaryTab` (the embed-page-local component, NOT the
shared one), render a horizontally-scrolling row of compact cards
(thumbnail + 1-line title + score reason chip).

### H2. Behaviour notes
- Use `api.cardConnections(cardId, 5)` (already exists, returns
  `Connection[]` with `score` and `reasons`).
- Click → navigate the iframe to `/embed/cards/<related>`.
- Loading state: 3 skeleton tiles.
- Empty state (no connections): hide the section entirely. New cards
  won't have edges yet.

## Block I — Inline notes editor

**Goal:** edit notes directly in the panel instead of bouncing to the
main app.

### I1. Approach
The main app's `RichTextEditor` is heavy (TipTap + StarterKit + Link +
Placeholder). For the side panel we keep it light — a textarea with
markdown, save on blur or `Cmd+Enter`. The user already gets full
TipTap when they click "Open in Mindshift".

### I2. Wiring
- New `apiUpdateNotes(cardId, notes_md)` — already exists as
  `api.updateNotes` (verify signature in lib/api.ts).
- `NotesTab` swaps from MarkdownView to a simple textarea-based editor
  controlled by local state, with debounced auto-save (1.5 s of idle)
  and a tiny "Saving…" / "Saved" pill.
- Optimistic local-state update; if save fails, show "Save failed —
  retry" with a retry button. No data loss because the textarea state
  is the source of truth until next mount.

## Block J — Default translation language preference

**Goal:** if the user prefers their library in German, every newly
embedded card automatically translates to German on first paint.

### J1. Backend — user preferences scaffolding

#### Schema
Add `preferences_json` JSONB column to `users` table. Default `{}`.

```python
preferences_json: Mapped[dict | None] = mapped_column(
    JSONB, nullable=True, default=dict, server_default="{}"
)
```

#### Migration
`backend/app/migrations/versions/0020_user_preferences.py` adds the
column with `server_default='{}'`. No backfill needed — `.get()` on
None returns None and the frontend treats missing as "no preference".

#### Endpoints
- `GET /api/users/me/preferences` → `{ default_translation_language: str|None }`
- `PATCH /api/users/me/preferences` → merges `{key: value}` updates.

Pydantic schema enforces a small allowlist of recognised keys today
(`default_translation_language`) so the JSONB doesn't become a
free-for-all that breaks on schema drift later.

### J2. Frontend
- `api.getPreferences()` / `api.updatePreferences()` in `lib/api.ts`.
- Settings UI: extend `SettingsModal` with a single dropdown
  "Default translation language" — None / Deutsch / English / …
  Same list as `CardLanguagePicker`'s `COMMON_LANGUAGES`.
- `EmbedCardPage` loads the preference on mount; if set AND the card
  has no translation in that language yet, calls
  `api.createTranslation(cardId, lang)`. Once the translation status
  flips to `ready`, swap `activeTranslation` automatically.
- "Original" stays selectable — preference only triggers the initial
  auto-translate, doesn't lock the user into it.

### J3. Tests
- Backend: integration test creates a user, PATCHes preference,
  verifies GET returns the same value. (Skipped if pytest is not
  installed; basic curl smoke instead.)
- Frontend: visual verification via the running dev server — set
  preference → open a card → translation appears or kicks off
  automatically.

## Order of execution
1. **G** (inline search) — smallest, validates the mini-bar pattern.
2. **H** (related cards) — pure read endpoint, no schema changes.
3. **I** (inline notes editor) — touches the existing notes tab
   render but no new endpoints.
4. **J** (translation preference) — last because it spans backend
   migration + endpoints + frontend wiring + visual verification;
   biggest single block.

## Commit boundaries
- `feat(embed): inline search bar in side panel mini-bar`
- `feat(embed): related-cards strip at the bottom of summary`
- `feat(embed): edit notes inline in side panel`
- `feat: user preferences + default translation language`

## Out of scope
- Quick-chat in the panel (#11). Side panel is too narrow for a
  productive chat session, and "Open in Mindshift" handles it
  better. Defer indefinitely.
- Migrating bulk preferences (theme, sound, etc) into the
  preferences_json. Existing per-feature localStorage keys stay
  where they are; only NEW preferences land in the JSONB.
