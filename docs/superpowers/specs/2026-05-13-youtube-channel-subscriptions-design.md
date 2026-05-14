# YouTube Channel Subscriptions — Design Spec

**Date**: 2026-05-13
**Status**: Approved (brainstorming phase complete)
**Author**: Chris + Claude

## 1. Problem & Goals

The Discover tab today gives users two surfaces for finding YouTube content:
theme-based suggestions (LLM-generated queries from the user's library) and a
free-text custom search. What's missing is the **creator axis**: a way to
follow specific YouTube channels, browse their uploads, and either save new
videos manually or let new uploads flow into the library automatically.

Goals:
- Let the user subscribe to YouTube channels (`UCxxx…`) from multiple entry
  points without leaving the app.
- Show new uploads as an **unread inbox** per channel; the user picks what
  becomes a card.
- Offer an optional **auto-ingest** per channel that turns every new upload
  into a card via the existing `from-youtube` ingestion pipeline.
- Stay quota-cheap: polling via free YouTube RSS feeds, not the paid Data
  API.
- Keep Discover as the single "Inspire" surface — no new top-level route.

Non-goals (deferred):
- Keyword/title filters for auto-ingest (only "exclude shorts" in MVP).
- Notifications, badges in the icon-rail, push.
- Cross-user channel-sharing or public discovery of channels.
- Backfill of historical uploads beyond the latest RSS window (15 entries).

## 2. Decisions Locked In During Brainstorming

| # | Decision | Why |
|---|---|---|
| D1 | Hybrid Browse + optional Auto-Ingest | Maximum flexibility, low default friction |
| D2 | Four entry points: search, URL-paste, library suggestions, card-detail button | All friction levels covered |
| D3 | UI lives inside `/discover` (sidebar section), not a new route | Keep "Inspire" as one surface |
| D4 | Channel-detail uses three tabs: Latest / Popular / Saved | Matches user expectation; reuses existing UI primitives |
| D5 | Per-channel toggle `manual` ↔ `auto`. Default `manual`. | Manual = unread inbox + "Save all"; Auto = silent ingest |
| D6 | Polling via free YouTube channel RSS (`feeds/videos.xml?channel_id=…`), 30 min interval | Zero Data-API quota for polling |
| D7 | `exclude_shorts` toggle, default `true`. No other filters in MVP. | Avoid auto-ingest noise from Short-heavy channels |
| D8 | Own domain model (`channel_subscriptions`, `channel_videos`) — separate from `feeds` table | Different UX & data shape; shared polling helper only |

## 3. Data Model

Three new tables. All migrations in one Alembic revision.

### `channel_subscriptions`

One row per (user, channel) subscription.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users` ON DELETE CASCADE | |
| `channel_id` | str (24) | YouTube `UCxxx…` |
| `handle` | str? | `@LexFridman` if known |
| `title` | str | display name |
| `thumbnail_url` | str? | channel avatar |
| `description` | str? | channel description |
| `subscriber_count` | int? | snapshot at resolve time, best-effort |
| `ingest_mode` | enum(`manual`, `auto`) | default `manual` |
| `exclude_shorts` | bool | default `true` |
| `etag` | str? | RSS conditional GET |
| `last_modified` | str? | RSS conditional GET |
| `last_polled_at` | timestamp? | |
| `last_error` | str? | last polling error message |
| `items_ingested` | int | running counter |
| `created_at` | timestamp | |

Constraints: `UNIQUE(user_id, channel_id)`.

### `channel_videos`

Per-channel inbox of uploads observed via RSS. Not every row becomes a card —
this is the "unread inbox" surface.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `subscription_id` | UUID FK → `channel_subscriptions` ON DELETE CASCADE | |
| `video_id` | str (11) | YouTube video id |
| `title` | str | |
| `thumbnail_url` | str? | |
| `duration_seconds` | int? | best-effort; not always in RSS |
| `published_at` | timestamp | from RSS `<published>` |
| `is_short` | bool | URL-heuristic at parse time |
| `read_at` | timestamp? | NULL → unread |
| `saved_card_id` | UUID FK → `cards` ON DELETE SET NULL | |
| `discovered_at` | timestamp | when our polling first saw it |

Constraints: `UNIQUE(subscription_id, video_id)`.

### `channel_video_pop_cache` (optional, ship with MVP)

Caches the "Popular" tab's content per channel so each tab-view doesn't burn
Data-API quota.

| Column | Type | Notes |
|---|---|---|
| `subscription_id` | UUID PK FK → `channel_subscriptions` ON DELETE CASCADE | |
| `payload` | JSONB | top-10 by view count, full video metadata |
| `fetched_at` | timestamp | TTL 24h |

If the popular tab proves over-scoped for MVP, drop this table and just call
the Data API live, gated on `fetched_at` in memory. Decision delegated to
implementation plan.

## 4. Backend API

All endpoints under `/api/channels`. JWT-gated like the rest. Pydantic
schemas in `backend/app/schemas/channels.py`.

### Discovery & resolve

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels/search?q=…` | YouTube Data API `search.list&type=channel`, max 10. **Cost: 100 units per call.** |
| `POST` | `/api/channels/resolve` | Body `{url_or_handle}`. Parses `youtube.com/@x`, `youtube.com/channel/UCx`, bare handle, bare URL. Calls `channels.list` (1 unit). |
| `GET` | `/api/channels/suggestions` | Library-derived. SELECT channel_id, COUNT(*) FROM cards WHERE source_type='youtube' AND user_id=…  GROUP BY channel_id HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 10 — filtered to those the user hasn't subscribed to. Zero API cost. |

### Subscription CRUD

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels` | List. Includes `unread_count` per row. |
| `POST` | `/api/channels` | Body `{channel_id}`. Resolves metadata + persists + queues first RSS pull via BackgroundTasks. |
| `DELETE` | `/api/channels/{id}` | Cascade drops `channel_videos`; saved cards untouched (SET NULL). |
| `PATCH` | `/api/channels/{id}` | Body `{ingest_mode?, exclude_shorts?}`. Switching `manual → auto` does NOT backfill — applies to future polls only. |

### Channel-detail tabs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels/{id}/videos?tab=latest&offset=…&limit=…` | From `channel_videos`, ORDER BY `published_at DESC`. |
| `GET` | `/api/channels/{id}/videos?tab=popular` | Cache-first (24h), fallback to Data API. |
| `GET` | `/api/channels/{id}/videos?tab=saved` | JOIN to `cards` via `saved_card_id IS NOT NULL`. |

### Video actions

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/channels/{id}/videos/{video_id}/save` | Triggers `services.ingestion.ingest_from_youtube`; sets `saved_card_id` + `read_at`. Returns `{card_id}`. |
| `POST` | `/api/channels/{id}/save-all-unread` | BackgroundTask. Saves all unread, honoring `exclude_shorts` toggle. Returns `{queued: n}`. |
| `POST` | `/api/channels/{id}/mark-read` | Sets `read_at = NOW()` on all unread, without ingesting. |
| `POST` | `/api/channels/{id}/refresh` | Manual on-demand RSS pull (analog to `feeds/{id}/refresh`). |

### Card-detail integration

The card-detail response (`GET /api/cards/{id}`) gains two optional fields
when `source_type='youtube'`:
- `channel_subscription_id: UUID?` — present if the user is already subscribed.
- `channel_resolvable: {channel_id, title}?` — present if not.

The frontend uses these to render either a "Subscribed ✓" link or a
"Subscribe to channel" button.

## 5. Polling & Ingestion

### Scheduler

`services/channel_scheduler.py` — separate APScheduler job, runs in the same
process as `feed_scheduler`. Interval: `CHANNEL_POLL_INTERVAL_MIN` env var,
default `30`. Iterates all `channel_subscriptions` rows (single scheduler
job, all users — same shape as feeds).

### Per-channel poll

```
fetch https://www.youtube.com/feeds/videos.xml?channel_id=<channel_id>
  with If-None-Match: <etag>, If-Modified-Since: <last_modified>

if 304:
    update last_polled_at; return

if 200:
    parse Atom feed (latest 15 entries)
    for entry in entries:
        video_id = entry['yt:videoId']
        if exists (subscription_id, video_id): continue
        is_short = '/shorts/' in entry['link'] href
        insert channel_videos row with read_at=NULL
        new_videos.append(row)

    cap new_videos to 10 (republish-storm guard)

    if subscription.ingest_mode == 'auto':
        for v in new_videos:
            if subscription.exclude_shorts and v.is_short: continue
            BackgroundTasks.add(ingest_from_youtube, v.video_id, user_id)
            on success: set v.saved_card_id, v.read_at = NOW()

    update etag, last_modified, last_polled_at, items_ingested += n

on error:
    set last_error; do NOT raise — continue with next channel
```

### Initial pull

`POST /api/channels` queues an immediate BackgroundTask that runs the same
RSS pull, so the UI shows content within seconds. **Crucial:** the initial
pull never auto-ingests, even when `ingest_mode=auto`. Otherwise subscribing
to a channel with `auto` on would silently produce 15 cards at once —
surprising. Auto-ingest only triggers on **deltas** observed in subsequent
polls.

### Shared polling helper

Extract from existing `feed_scheduler.py`:

```
# backend/app/services/http_polling.py

def conditional_fetch(url: str, etag: str | None, last_modified: str | None,
                      timeout: float = 10.0) -> ConditionalFetchResult:
    """HTTP GET with If-None-Match / If-Modified-Since.
    Returns:
        status: 'not_modified' | 'ok' | 'error'
        body: str | None
        etag: str | None
        last_modified: str | None
        error: str | None
    """
```

`feed_scheduler.py` is refactored to use this helper. The XML/Atom parsing
stays in each scheduler — they're different schemas (RSS 2.0 / Atom 1.0 vs
YouTube's `yt:` namespaced Atom).

### Recovery

Existing `services/recovery.py` reaper handles orphaned
`cards.status='processing'` rows from auto-ingest backgrounds killed by a
backend restart. No new recovery code.

## 6. Frontend

### Routing & state

- Path remains `/discover`. Channel selection is a URL search param:
  `/discover?channel=<subscription_id>`. This lets users deep-link and lets
  the back button work without losing context.
- When `?channel=` is set, the main content area renders `ChannelDetailView`
  instead of the theme grid. The toolbar (search + freshness) hides; the
  theme sidebar stays.

### Sidebar additions in `DiscoverPage.tsx`

A new `<section>` between "Themen" and "Letzte Suchen":

```
▸ Channels                [+]
  ▸ Lex Fridman           ●3
  ▸ 3Blue1Brown
  ▸ Stratechery           ●1
  ─ Suggestions ⌄
```

- `[+]` opens `<AddChannelModal>`.
- Each row: small (16px) avatar + title + unread badge (small pill, hidden
  when 0).
- "Suggestions" collapses by default; expanded it shows up to 5
  library-derived recommendations with one-click subscribe.
- Mobile: channels collapse into the existing theme-chip row as a separate
  horizontally-scrollable band ("Channels: [Lex] [3B1B] …"). Add-channel
  via a floating `+` chip at the end.

### `<AddChannelModal>`

Three sub-tabs:

1. **Search** — debounced (300ms) text field → `GET /channels/search` →
   rendered list (avatar / title / subscriber count / description-preview /
   Subscribe button). Subscribe optimistically inserts into the sidebar.
2. **Paste URL** — input + button → `POST /channels/resolve` → single
   result card with Subscribe.
3. **From your library** — `GET /channels/suggestions` results with
   "X cards from this channel in your library" hint.

### `<ChannelDetailView>`

```
┌─────────────────────────────────────────────────────┐
│ [Avatar] Lex Fridman  @LexFridman  · 4.2M Subs       │
│ Conversations about science, technology, philosophy. │
│ [Auto-Ingest: ⚪off]  [⚙]  [⟳ Refresh]              │
├─────────────────────────────────────────────────────┤
│ [Latest] | [Popular] | [Saved 3]                     │
├─────────────────────────────────────────────────────┤
│ 3 unread   [Save all]  [Mark all read]               │ ← only when unread > 0 on Latest
├─────────────────────────────────────────────────────┤
│ ●  [thumb] "Title…"          2d ago  42:01  [Save]  │
│    [thumb] "Title…"          5d ago  61:24  [✓Saved]│
│    [thumb] "Title… (Short)"  1w ago   0:42  [Save]  │ ← dimmed if exclude_shorts
│ …                                                    │
│ [ Load more ]                                        │
└─────────────────────────────────────────────────────┘
```

Components:

- `<ChannelHeader>` — avatar, title, handle, subscriber count, description.
  Top-right cluster: auto-ingest toggle (with confirm-on-enable modal),
  settings popover (exclude_shorts toggle, "Remove channel" with confirm),
  refresh button.
- `<ChannelVideoList>` — reuses the layout/visual rhythm of
  `DiscoverVideoRow.tsx`, with two extras: an unread indicator dot at the
  left edge of each row and a Short-label badge when `is_short`.
- `<UnreadActionBar>` — only on the Latest tab when `unread_count > 0`.
  "Save all" triggers `POST /save-all-unread` and shows a progress badge
  ("3/12 saved…") polled every 3s until the count stabilizes.
- The Saved tab reuses the existing card-row layout used in Library so
  saved videos look like cards, not search results.

### `CardDetailPage.tsx`

In the card-detail header (currently shows source-type + creator), add a
small button next to the creator name when `source_type='youtube'`:
- Not subscribed → "+ Subscribe to channel" → `POST /channels` with the
  card's `channel_id` payload.
- Subscribed → "✓ Subscribed" → links to `/discover?channel=<sub_id>`.

### `lib/api.ts` additions

New types:
- `ChannelSubscription { id, channel_id, title, handle?, thumbnail_url?, subscriber_count?, ingest_mode, exclude_shorts, unread_count, last_polled_at?, last_error? }`
- `ChannelVideo { video_id, title, thumbnail_url?, duration_seconds?, published_at, is_short, read_at?, saved_card_id? }`
- `ChannelSearchResult { channel_id, title, handle?, thumbnail_url?, subscriber_count?, description? }`
- `ChannelSuggestion extends ChannelSearchResult { card_count_in_library: number }`

New methods on `api`:
- `listChannels()`, `searchChannels(q)`, `resolveChannel(input)`,
  `getChannelSuggestions()`, `subscribeChannel(channel_id)`,
  `unsubscribeChannel(id)`, `patchChannel(id, patch)`,
  `getChannelVideos(id, tab, offset)`, `saveChannelVideo(id, video_id)`,
  `saveAllUnread(id)`, `markChannelRead(id)`, `refreshChannel(id)`.

### i18n

All strings under the `discover.channels.*` namespace in both `de.json` and
`en.json`. Key list (non-exhaustive):
- `discover.channels.title`
- `discover.channels.add`, `discover.channels.addModal.{search,paste,fromLibrary}`
- `discover.channels.subscribe`, `discover.channels.unsubscribe`
- `discover.channels.autoIngest.{label,enableConfirm,enabled,disabled}`
- `discover.channels.excludeShorts`
- `discover.channels.tabs.{latest,popular,saved}`
- `discover.channels.unread.{count,saveAll,markAllRead,progress}`
- `discover.channels.suggestions.title`, `discover.channels.suggestions.cardsInLibrary`
- `discover.channels.errors.{resolveFailed,searchFailed,quotaExceeded}`
- `card.subscribeToChannel`, `card.subscribedToChannel`

## 7. Configuration

New env vars:
- `CHANNEL_POLL_INTERVAL_MIN` (default `30`)
- `CHANNEL_MAX_NEW_PER_POLL` (default `10`)
- `CHANNEL_POPULAR_CACHE_TTL_HOURS` (default `24`)

`YOUTUBE_API_KEY` is reused (already exists for Discover themes & search).

## 8. Edge cases & error handling

| Case | Behaviour |
|---|---|
| YouTube RSS returns 404 (channel deleted/renamed) | Set `last_error`, mark subscription `inactive` after 3 consecutive failures (new column? — TBD: simpler to just keep `last_error` visible in the UI and let the user delete). **Decision: surface `last_error` in the sidebar tooltip; user removes the dead channel manually. No auto-deactivation in MVP.** |
| Channel uploads a republish (re-edited video same id) | Dedupe by `video_id` — ignored, no duplicate row. |
| User clicks Subscribe twice / race | `UNIQUE(user_id, channel_id)` constraint catches; backend returns the existing row idempotently. |
| `from-youtube` ingestion fails on auto-ingest | The `channel_videos` row stays with `read_at=NULL`, `saved_card_id=NULL`. User sees it as unread + can retry by clicking Save manually. Don't loop-retry automatically in MVP. |
| User subscribes via card-detail to a channel that has no resolvable channel_id (rare — pre-2018 videos without `snippet.channelId`) | Hide the Subscribe button; don't break the page. |
| YouTube Data API quota exceeded on search/resolve | Bubble the error to the frontend with a friendly i18n key (`discover.channels.errors.quotaExceeded`). Subscriptions/polling stay unaffected because they're RSS. |
| `save-all-unread` mid-flight while user navigates away | BackgroundTask continues server-side; the channel-detail polls progress when re-entered. |
| Card deletion via Library | `saved_card_id` becomes NULL (FK SET NULL). The video row stays in `channel_videos` but loses its "Saved" badge — appears as unread again until manually marked. **Decision: leave `read_at` intact when the card is deleted (so the user doesn't see a sudden flood of unreads), only `saved_card_id` clears.** |

## 9. Build sequence (high-level — full plan in next step)

1. Alembic migration: `channel_subscriptions`, `channel_videos`,
   `channel_video_pop_cache`.
2. Models + schemas + service layer (`channel_subscribe`,
   `channel_videos`, `channel_search`).
3. Refactor: extract `services/http_polling.py` from
   `feed_scheduler.py`; re-wire feeds to use it.
4. Channel scheduler + RSS parser + first-pull BackgroundTask.
5. API endpoints: discovery, CRUD, video tabs, video actions.
6. Card-detail API: emit `channel_subscription_id` / `channel_resolvable`.
7. Frontend types & API client.
8. `AddChannelModal` (search tab first, then URL, then library).
9. Sidebar channel section (list + unread badges + add button).
10. `ChannelDetailView` — Latest tab first, then Saved, then Popular.
11. Card-detail Subscribe button.
12. i18n keys (de + en together).
13. Manual smoke test: subscribe via all four paths, toggle auto-ingest,
    poll, save-all-unread, unsubscribe.

## 10. Post-MVP iterations (landed)

The MVP shipped on the date above. The following refinements were
added in subsequent commits — captured here so the spec stays in
sync with what the codebase actually does.

### 10a. Lazy channel_id backfill (commit `df28b20`)

Cards ingested before this work captured only the channel title in
`source.metadata_json`, not the channel_id. The suggestions endpoint
+ the card-detail `_card_response` both now batch-resolve missing
ids via `videos.list` (1 unit per 50 video ids), persist the result
into `metadata_json` so subsequent calls are free, and surface the
„Subscribe to channel" chip on legacy cards.

### 10b. Inline subscribe + per-row Auto pill + bulk subscribe (commit `cfc9d7f`)

`AddChannelModal` no longer auto-jumps into the channel detail. The
clicked row flips inline to `✓ Abonniert · Manuell/Auto`, modal stays
open. Each row carries a `⚡ Auto` pill (default off) that decides
the ingest mode at subscribe time — no confirm dialog needed, because
toggling the pill IS the explicit gesture. The library-suggestions
tab additionally renders a „Alle N abonnieren" bulk action with its
own ⚡ Auto pill.

### 10c. Inline + sticky-mini video player (commit `0be391c`)

Channel video rows let you preview videos before importing. A click
on the thumbnail (or the title) expands a 16:9 YouTube embed in the
row. When the active row scrolls out of the viewport, the SAME
iframe is repositioned via `createPortal` to a fixed 320×180
bottom-right corner — no remount, video keeps playing. Mini-mode
controls: close (`Esc` also works) and „Zur Liste" (scroll back to
the active row).

### 10d. Stability (commit `<this PR>`)

- **Sequential ingestion drain.** `save-all-unread` and auto-ingest
  inside `poll_channel` previously spawned one daemon thread per
  video. With 10+ unreads or a fresh channel posting a burst, the
  parallel transcript fetches against `youtube-transcript-api` cause
  IP-level rate-limiting from YouTube. Both paths now use the same
  drain-with-delay pattern proven in `services/feeds.py`: 4 s
  between YouTube items, single worker thread.

- **`?channel=<id>&tab=<latest|popular|saved>` URL state.** The active
  tab survives reload and is preserved when switching channels.

- **Quota-friendly search debounce.** The channel search field in the
  AddChannelModal debounces by 300 ms before firing the Data API call
  (100 units / call), preventing each keystroke from burning quota.

- **Auto-ingest errors visible.** When auto-ingest fails to queue a
  card (rare — usually quota / config), the subscription's
  `last_error` carries the message so the channel detail can flag it.

- **Toast for bulk save success.** The earlier `setError(...)` hack
  to surface „N cards queued" is replaced by `useToast()`.

- **Optimistic-update rollback.** Save-one / mark-read / save-all
  now revert their local state changes when the underlying API call
  fails, so the UI can't diverge from the backend.

## 11. Out of scope (named explicitly to avoid scope creep)

- Title/description keyword filters for auto-ingest.
- Notifications (push, badge in icon-rail).
- OAuth-based "import my YouTube subscriptions".
- Cross-user discovery (which channels are popular among other Mindshift
  users).
- Channel-level tags or auto-tagging defaults.
- Mobile push notifications when a new video appears.
- Webhook-based / PubSubHubbub realtime ingestion. (Possible follow-up —
  YouTube's RSS feeds support PSHB, but the 30 min polling is fine for
  MVP.)
- Free-drag mini-player (was option C in the inline-player brainstorm;
  the sticky corner is fine).
- Per-channel notification settings beyond the global auto/manual
  toggle.
