# Path Player Phase 2c — Inline PDF Reader

**Date:** 2026-05-10
**Status:** Drafted, awaiting user review
**Predecessor:** Phase 2a (`2026-05-10-path-player-phase-2a-design.md`) shipped — public path consumption is live but PDF cards still show only an "Open original" link.
**Sibling concept:** Phase 1 mini-on-scroll (YouTube embed shrinks to top-right corner once user scrolls past). Phase 2c extends the same pattern to PDFs.

---

## 1. Context & problem

Phase 1 gave path-step pages a real video experience — YouTube embeds render inline, shrink to a sticky mini-player on scroll, keep playing. Phase 2a made all card content (Summary, Transcript, Quiz) accessible to public-path consumers. But PDF cards still render only an `<a href={source_url}>Open original</a>` link — for both the owner (in the library and the player) and anonymous / logged-in non-owner consumers of public paths. Reading a PDF inside Mindshift means leaving Mindshift.

Phase 2c brings PDF cards to feature parity with YouTube: an inline reader with a real toolbar, page navigation, zoom, fullscreen, and the same shrink-to-corner behaviour the user is now used to.

## 2. Goals

- Inline PDF rendering in `CardSourceMedia` for `source_type === "pdf"` cards.
- Standard reader toolbar: prev/next page, "Page X / Y" indicator, jump-to-page input, zoom +/-, fit-width preset, fullscreen.
- Mini-on-scroll behaviour identical to YouTube — when the user scrolls past the source-media area in `PathPlayerPage`, the PDF wrapper pins to the top-right corner. In compact mode the reader hides the toolbar and shows only "Page X / Y" plus a Maximize button.
- Works for the **owner** in their own library card detail and own path player.
- Works for the **public consumer** (anonymous + logged-in non-owner) inside a public path player.
- Falls back to today's "Open original" link if the PDF can't be loaded (404, parse error, no `original_file_id` and no `source_url`).

## 3. Non-goals

- **No PDF search.** The lesson note tells the user which page to read; full-text search inside the PDF is overkill for the learning context.
- **No thumbnails sidebar.** Same reason — adds chrome without proportional value.
- **No annotations / highlights.** Distinct feature; out of scope.
- **No Print / Download buttons in the reader toolbar.** Owner already has those in the card-detail Action Bar; consumers shouldn't get them inline (they can use the browser's PDF viewer download via the source URL if present).
- **No anonymous PDF download outside the player.** The new public file endpoint streams blobs only via `/api/public/paths/{u}/{s}/cards/{cid}/file` — gated by the same `_load_public_card_in_path` helper from 2a.
- **No upgrade of disk-uploaded PDFs into source_url-based PDFs.** If a PDF was uploaded from disk, `source_url` is null; we use `original_file_id` to fetch the blob. The reader works for both shapes.

## 4. Approach choice — react-pdf with build-our-own toolbar

The user picked `react-pdf` over the browser-native `<iframe>` route. That means:
- New dep: `react-pdf` (npm, wraps `pdfjs-dist`).
- A worker bundle (`pdf.worker.min.js`) that has to be wired into Vite so it loads correctly.
- We build the toolbar UI ourselves — full design control, consistent CDBrain styling.

This is heavier than the iframe path (~250 kb gzipped extra) but gives a Mindshift-native look across browsers and lets us drive UX decisions like the compact mini-mode.

## 5. Backend changes

### 5.1 New public file endpoint
Add to `app/api/paths.py` next to the other public consumer endpoints (after `get_public_card_quiz`):

```python
@public_router.get("/{username}/{slug}/cards/{card_id}/file")
def get_public_card_file(
    username: str,
    slug: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    """Streams the original blob (PDF, etc.) for a card inside a public
    path. Anonymous-OK; same access guard as the other public endpoints."""
    _, card = _load_public_card_in_path(db, username, slug, card_id)
    if card.original_file_id is None:
        raise HTTPException(status_code=404, detail="No original file")
    file = db.get(File, card.original_file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="No original file")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type=file.content_type or "application/pdf",
        headers={
            "Content-Length": str(len(blob)),
            "Cache-Control": "public, max-age=86400",
        },
    )
```

Imports to add at the top of the file: `File` from `app.models.file`, `get_storage` from `app.services.storage`. Verify both already exist; the owner endpoint at `app/api/files.py` uses the same pattern.

### 5.2 Test
Add to `backend/tests/test_public_paths.py`:

```python
def test_public_file_404_when_no_original(client, seeded_public_path):
    user = seeded_public_path.user
    path = seeded_public_path.path
    card_id = seeded_public_path.cards[0].id
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}/file")
    assert r.status_code == 404


def test_public_file_404_when_path_private(client, seeded_private_path):
    user = seeded_private_path.user
    path = seeded_private_path.path
    card_id = seeded_private_path.cards[0].id
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}/file")
    assert r.status_code == 404
```

A happy-path test would require seeding a real File row + storage blob — heavier than the existing fixtures support. The 404-correctness tests are the load-bearing ones; happy-path is exercised manually.

## 6. Frontend changes

### 6.1 New deps
Run inside `frontend/`:
```
npm install react-pdf
```

`pdfjs-dist` comes as a transitive dep of `react-pdf`. The worker file is shipped with `pdfjs-dist`; we configure react-pdf to load it via a Vite-compatible URL.

### 6.2 Vite worker configuration
Add a top-level `pdfjs.worker.ts` (in `frontend/src/lib/`) that points react-pdf at the worker shipped with `pdfjs-dist`. Pattern:

```ts
// frontend/src/lib/pdfjsWorker.ts
import { pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```

Import this once in `main.tsx` (top of file, same level as `import "./styles.css"`). The `?url` suffix is a Vite primitive that resolves to a public asset URL.

### 6.3 New component `frontend/src/components/PdfReader.tsx`
Responsibilities:
- Fetch the PDF blob (owner mode → `/api/files/{file_id}` with Bearer; public mode → `/api/public/paths/{u}/{s}/cards/{cid}/file` anonymous).
- Create a blob URL via `URL.createObjectURL(blob)`. Revoke on unmount.
- Render `<Document file={blobUrl}>` from react-pdf with a `<Page pageNumber={pageNumber} scale={scale}>` child.
- Render the toolbar: prev/next, page indicator, jump-to-page input, zoom +/-, fit-width preset, fullscreen.
- In compact mode, hide the full toolbar; show only "Page X / Y" + Maximize button.
- Fullscreen via View Transitions API (same pattern as `RichTextEditor` and `CardSourceMedia` YouTube-fullscreen — `document.startViewTransition(() => setFullscreen(v => !v))`). Both DOM positions carry `view-transition-name: pdf-reader`.
- On load error: render the existing "Open original" fallback (or a non-clickable error if `source_url` is null).

Props:
```ts
interface PdfReaderProps {
  card: Card;
  /** Owner mode hits /api/files; public hits the public endpoint. */
  mode: { kind: "owner" } | { kind: "public"; username: string; slug: string };
  /** When true, hide most of the toolbar and show only page indicator + maximize. */
  compact?: boolean;
}
```

Internal state: `pageNumber`, `numPages`, `scale`, `loadError`, `fullscreen`, `blobUrl`, `jumpInput`.

Keyboard shortcuts: `←` / `→` page nav, `+` / `-` zoom, `0` fit-width, `Esc` exit fullscreen — only when no input has focus.

### 6.4 `CardSourceMedia` integration
Today's PDF branch renders the "Open original" link. Replace with:

```tsx
if (card.source_type === "pdf") {
  return <PdfReader card={card} mode={pdfMode} compact={compact} />;
}
```

`pdfMode` and `compact` come from new optional props on `CardSourceMediaProps`:

```ts
interface CardSourceMediaProps {
  card: Card;
  fitHeight?: boolean;
  /** Drives PdfReader source URL choice. Defaults to owner mode. */
  pdfMode?: { kind: "owner" } | { kind: "public"; username: string; slug: string };
  /** Forwarded to PdfReader for mini-on-scroll. */
  compact?: boolean;
}
```

Owner usages (library card detail, ChatTab) pass nothing → both default to owner / non-compact. The path player passes the right `pdfMode` and `compact` down explicitly.

If the PDF can't be rendered (load error), `PdfReader` itself returns the today's "Open original" link as a fallback — `CardSourceMedia` doesn't need a separate fallback path.

### 6.5 `PathPlayerCardView` mini-on-scroll extension
Today the `pinningEligible` check gates on YouTube. Extend:

```ts
const pinningEligible =
  (card?.source_type === "youtube" && !!card?.external_id) ||
  card?.source_type === "pdf";
```

The IntersectionObserver and Maximize button stay unchanged. Pass `compact={isPinned}` and the `pdfMode` discriminated-union down to `CardSourceMedia`:

```tsx
<CardSourceMedia
  card={card}
  pdfMode={
    playerMode.kind === "owner"
      ? { kind: "owner" }
      : { kind: "public", username: playerMode.username, slug: playerMode.slug }
  }
  compact={isPinned}
/>
```

The mini-overlay container stays the same — only the inner element (`<CardSourceMedia>`) knows it's compact and renders accordingly. The fixed-position class swap from Phase 1 still works because the wrapper div is the same.

Mini overlay size for PDF: 240 × 320 px (vs YouTube's 320 × 180). This is a CSS adjustment in `PathPlayerCardView` — gate the size class on source_type:

```tsx
isPinned
  ? card.source_type === "pdf"
    ? "fixed right-4 top-24 z-30 h-80 w-60 ..."
    : "fixed right-4 top-24 z-30 aspect-video w-80 ..."
  : "..."
```

(Or just use `w-60 h-80` for PDF — natural A4 aspect ratio is closer to 1:1.4, so 240 × 320 ≈ 1:1.33, close enough.)

### 6.6 `lib/api.ts` helpers
Add a `fetchOriginalFileBlob(fileId)` that returns a Blob (owner mode):

```ts
fetchOriginalFileBlob: async (fileId: string): Promise<Blob> => {
  const token = localStorage.getItem("mindshift.token");
  const res = await fetch(`/api/files/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
},
```

And a `fetchPublicPathCardFileBlob(username, slug, cardId)`:

```ts
fetchPublicPathCardFileBlob: async (username, slug, cardId): Promise<Blob> => {
  const res = await fetch(
    `/api/public/paths/${username}/${slug}/cards/${cardId}/file`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
},
```

`PdfReader` calls one or the other based on `mode.kind`.

### 6.7 i18n keys
Add to `frontend/src/locales/en.json` (under `card` or new `pdf` namespace — go with `pdf`):

```json
"pdf": {
  "page": "Page",
  "of": "of",
  "previousPage": "Previous page",
  "nextPage": "Next page",
  "jumpToPage": "Jump to page",
  "zoomIn": "Zoom in",
  "zoomOut": "Zoom out",
  "fitWidth": "Fit width",
  "fullscreen": "Fullscreen",
  "exitFullscreen": "Exit fullscreen",
  "loadError": "Couldn't load the PDF",
  "openOriginal": "Open original"
}
```

`de.json` mirror with German translations.

## 7. Edge cases

- **Card with `original_file_id` only (disk upload, no source_url)** → owner gets the inline reader; public consumer gets it via the new public file endpoint; if both ways fail, fallback "Open original" is hidden because there's no URL — show "Couldn't load the PDF" inline error.
- **Card with `source_url` only (URL-fetched PDF, no stored blob)** → owner has no `original_file_id`, so the file endpoint 404s; fall back to "Open original" link to `source_url`.
- **Card with neither** → render nothing (today's behaviour for any non-renderable card).
- **PDF too large (>10 MB)** → react-pdf streams pages on demand; first-paint latency is acceptable (~1–2 s on slow connections). No special handling.
- **Password-protected PDF** → react-pdf's `<Document>` `onLoadError` fires; we show the "Couldn't load the PDF" error + "Open original" link.
- **iOS Safari** → react-pdf renders to canvas; works on iOS Safari per react-pdf's compatibility matrix. Fullscreen may need a polyfill (or use the native `requestFullscreen()` instead of View Transitions if VT support is patchy on iOS — verify).
- **Card detail in library (owner mode, no path context)** → `compact` always false; mini-on-scroll never fires (no IntersectionObserver in `CardDetailContent`); reader is full-toolbar.
- **Tab switch in path player while PDF is loading** → blob URL is created on `<PdfReader>` mount; tab switch unmounts CardSourceMedia? Actually no — `CardSourceMedia` is rendered above the tab strip, not inside it. So tab switches don't affect the PDF state. Good.
- **Step change in path player** → `PathPlayerCardView` remounts via `key={card_id}`, so `<PdfReader>` remounts too, blob URL is fresh.

## 8. Done criteria

- New backend endpoint passes both 404 tests; manual happy-path verified by viewing a real public path with a PDF step.
- `react-pdf` and `pdfjs-dist` installed; Vite worker loads without errors in dev console.
- New `PdfReader.tsx` component renders a sample PDF in:
  - Owner library card detail
  - Owner path player
  - Public path player (logged-in)
  - Public path player (anonymous)
- Mini-on-scroll works for PDF cards in path player: scroll down → reader pins top-right with compact toolbar; click Maximize → smooth scroll to top + reader expands.
- Toolbar interactions: prev/next, jump-to-page, zoom in/out, fit-width, fullscreen all work with both mouse and keyboard shortcuts.
- Fallback to "Open original" link when PDF fails to load.
- Type-check clean. Backend tests 8 / 8 passing (6 from 2a + 2 new from 2c).

## 9. Open questions for user review

None at the time of writing. Proceed to implementation plan if the spec looks right.
