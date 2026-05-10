# Path Player Phase 2c — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline PDF reader for PDF cards in both owner and public-path-consumer contexts, with the same mini-on-scroll pinning behaviour from Phase 1.

**Architecture:** New `react-pdf`-based `PdfReader` component with a custom toolbar (prev/next, jump-to-page, zoom, fit-width, fullscreen). `CardSourceMedia` switches PDF cards from today's "Open original" link to the inline reader. `PathPlayerCardView`'s IntersectionObserver-based mini-on-scroll extends from YouTube-only to YouTube+PDF, with a different mini-size (240×320 vs 320×180). One new unauthenticated backend endpoint streams PDF blobs scoped to a public path; reuses the `_load_public_card_in_path` helper from 2a.

**Tech Stack:** react-pdf (wraps pdfjs-dist), Vite worker config, FastAPI for the new endpoint. No new tables, no migrations.

**Spec reference:** `docs/superpowers/specs/2026-05-10-path-player-phase-2c-design.md`.

**Branch strategy:** new branch `feat/path-player-phase-2c` off `main`. Fast-forward main at the end.

**Test gate:** Backend `pytest` for the new endpoint. Frontend `npx tsc -b --noEmit` + manual smoke. No Playwright.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/api/paths.py` | modify | Add `get_public_card_file` endpoint reusing `_load_public_card_in_path`. |
| `backend/tests/test_public_paths.py` | modify | Add 2 tests: 404 when no original, 404 when path private. |
| `frontend/package.json` | modify | Add `react-pdf` dep. |
| `frontend/src/lib/pdfjsWorker.ts` | create | Configure pdfjs worker URL via Vite `?url` import. |
| `frontend/src/main.tsx` | modify | Import the worker config once at bootstrap. |
| `frontend/src/lib/api.ts` | modify | Add `fetchOriginalFileBlob` (owner) + `fetchPublicPathCardFileBlob` (public) helpers. |
| `frontend/src/components/PdfReader.tsx` | create | The new inline reader — full toolbar, compact mode, fullscreen, fallback. |
| `frontend/src/components/CardSourceMedia.tsx` | modify | PDF branch renders `<PdfReader>`; add optional `pdfMode` + `compact` props. |
| `frontend/src/components/PathPlayerCardView.tsx` | modify | Extend `pinningEligible` to include PDF; pass `pdfMode` + `compact` down; PDF mini-size variant. |
| `frontend/src/locales/en.json` | modify | Add `pdf.*` namespace keys. |
| `frontend/src/locales/de.json` | modify | German equivalents. |

---

## Task 1: Backend — public file endpoint + tests

**Files:**
- Modify: `backend/app/api/paths.py`
- Modify: `backend/tests/test_public_paths.py`

- [ ] **Step 1: Add the endpoint**

In `backend/app/api/paths.py`, locate the existing public consumer endpoints (`get_public_card`, `get_public_card_transcript`, `get_public_card_quiz`). Append after `get_public_card_quiz`:

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

Add the imports at the top of `paths.py` if missing (verify each first via grep before adding):
- `from app.models.file import File`
- `from app.services.storage import get_storage`
- `from fastapi import Response` (probably already there — `stream_public_cover` uses it)

- [ ] **Step 2: Add tests**

Append to `backend/tests/test_public_paths.py`:

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

The seeded fixture creates cards without `original_file_id`, so the first test verifies the empty-file path. The second test verifies the access guard.

- [ ] **Step 3: Run tests**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/backend
.venv/bin/pytest tests/test_public_paths.py -v 2>&1 | tail -15
```

Expected: 9 passed (7 from earlier phases + 2 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add backend/app/api/paths.py backend/tests/test_public_paths.py
git commit -m "feat(paths): public file endpoint for PDF source media"
```

---

## Task 2: Frontend — install react-pdf + worker config

**Files:**
- Modify: `frontend/package.json` (via `npm install`)
- Create: `frontend/src/lib/pdfjsWorker.ts`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Install the dependency**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend
npm install react-pdf
```

Verify the install: `cat package.json | grep -A0 react-pdf` should show the dep.

- [ ] **Step 2: Worker configuration**

Create `frontend/src/lib/pdfjsWorker.ts`:

```ts
// Configures react-pdf's pdfjs worker to load from a Vite-emitted asset URL.
// Imported once at app bootstrap (main.tsx) so the worker is ready before
// any <Document> component mounts.
import { pdfjs } from "react-pdf";
// `?url` is a Vite primitive that resolves the import to a public asset URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```

Note: `pdf.worker.min.mjs` is the modern entry; if `react-pdf`'s installed `pdfjs-dist` version uses the older `.js` extension, switch to that. Check the actual file by running `ls node_modules/pdfjs-dist/build/ | grep worker` and use whichever exists.

- [ ] **Step 3: Import the worker config in `main.tsx`**

Open `frontend/src/main.tsx`. Add this import near the other side-effect imports (`./i18n`, `./styles.css`):

```ts
import "./lib/pdfjsWorker";
```

Place it before `import "./styles.css";` for consistency with the existing ordering.

- [ ] **Step 4: Type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
```

Expected: `exit=0`. If TypeScript complains about missing types for `react-pdf` or the `?url` import, install `@types/react-pdf` (only if needed — react-pdf ships its own types in modern versions) and add `vite/client` to the project's `tsconfig.json` `types` array if it isn't already (this is what makes `?url` recognized).

- [ ] **Step 5: Verify Vite dev server still boots**

Run `./scripts/start.sh` if not running, or just bounce the frontend: `cd frontend && npm run dev` (don't actually keep it running here — just confirm it starts without errors and emit). Check the dev console — there should be no "module not found" or "worker failed to load" errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/package.json frontend/package-lock.json frontend/src/lib/pdfjsWorker.ts frontend/src/main.tsx
git commit -m "chore(frontend): add react-pdf + worker configuration"
```

---

## Task 3: API helpers for PDF blob fetching

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the two blob fetchers to the `api` object**

Locate the existing `getPublicPathCardQuiz` method (added in Phase 2a). Add these two methods right after it:

```ts
  fetchOriginalFileBlob: async (fileId: string): Promise<Blob> => {
    const token = localStorage.getItem("mindshift.token");
    const res = await fetch(`/api/files/${fileId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  fetchPublicPathCardFileBlob: async (
    username: string,
    slug: string,
    cardId: string,
  ): Promise<Blob> => {
    const res = await fetch(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/file`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
```

These bypass the existing `request<T>` helper because they return a Blob, not JSON. The fetch URL uses an absolute `/api/...` path — this matches the existing pattern (`request` uses the same base).

- [ ] **Step 2: Type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/lib/api.ts
git commit -m "feat(api): blob fetchers for owner + public PDF files"
```

---

## Task 4: Build `PdfReader` component

**Files:**
- Create: `frontend/src/components/PdfReader.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/PdfReader.tsx
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, Minus, Plus, RectangleHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page } from "react-pdf";

import { api, type Card } from "../lib/api";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export type PdfReaderMode =
  | { kind: "owner" }
  | { kind: "public"; username: string; slug: string };

interface PdfReaderProps {
  card: Card;
  mode: PdfReaderMode;
  /** Drives the compact mini-on-scroll variant: hide most toolbar
   *  controls, show only "Page X / Y" + Maximize button. */
  compact?: boolean;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.1;
const FIT_WIDTH_SCALE = 1.1; // close to "fit-width" for typical containers

export default function PdfReader({ card, mode, compact = false }: PdfReaderProps) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(FIT_WIDTH_SCALE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jumpInput, setJumpInput] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch the PDF blob on mount (and whenever the card or mode changes).
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const fetcher = async (): Promise<Blob> => {
      if (mode.kind === "owner") {
        if (!card.original_file_id) throw new Error("No original file");
        return api.fetchOriginalFileBlob(card.original_file_id);
      }
      return api.fetchPublicPathCardFileBlob(mode.username, mode.slug, card.id);
    };
    void fetcher()
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [card.id, card.original_file_id, mode]);

  // Keyboard shortcuts — only when no input has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.key === "Escape" && fullscreen) {
        e.preventDefault();
        setFullscreen(false);
        return;
      }
      if (compact) return; // no shortcuts in compact
      if (e.key === "ArrowLeft" && pageNumber > 1) setPageNumber((p) => p - 1);
      else if (e.key === "ArrowRight" && pageNumber < numPages) setPageNumber((p) => p + 1);
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP));
      else if (e.key === "-") setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP));
      else if (e.key === "0") setScale(FIT_WIDTH_SCALE);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageNumber, numPages, compact, fullscreen]);

  const onDocumentLoad = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setLoadError(err.message || "load failed");
  }, []);

  const goPrev = () => setPageNumber((p) => Math.max(1, p - 1));
  const goNext = () => setPageNumber((p) => Math.min(numPages, p + 1));

  const onJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpInput, 10);
    if (!Number.isFinite(n)) return;
    setPageNumber(Math.max(1, Math.min(numPages || 1, n)));
    setJumpInput("");
  };

  const toggleFullscreen = () => {
    type DocVT = Document & { startViewTransition?: (cb: () => void) => unknown };
    const doc = document as unknown as DocVT;
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => setFullscreen((v) => !v));
    } else {
      setFullscreen((v) => !v);
    }
  };

  // Fallback: render an "Open original" link when we can't load.
  if (loadError) {
    if (card.source_url) {
      return (
        <a
          href={card.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="surface-soft flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2 text-xs text-ink-200 transition hover:bg-ink-700/40 hover:text-ink-100"
        >
          <ExternalLink className="h-4 w-4 flex-shrink-0 text-ink-400" />
          <span className="flex-1 truncate font-mono">{card.source_url}</span>
          <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-ink-500">
            {t("pdf.openOriginal", { defaultValue: "Open original" })}
          </span>
        </a>
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-400">
        {t("pdf.loadError", { defaultValue: "Couldn't load the PDF" })}
      </div>
    );
  }

  // Compact mini-mode: page indicator + maximize button only.
  if (compact) {
    return (
      <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-ink-950">
        {blobUrl ? (
          <Document file={blobUrl} onLoadSuccess={onDocumentLoad} onLoadError={onDocumentLoadError}>
            <Page
              pageNumber={pageNumber}
              width={containerRef.current?.clientWidth ?? 240}
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </Document>
        ) : null}
        <div className="absolute bottom-1 left-1 rounded-md bg-ink-900/85 px-2 py-1 text-[10px] font-mono text-ink-200">
          {pageNumber} / {numPages || "…"}
        </div>
      </div>
    );
  }

  const wrapperClass = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-ink-950"
    : "flex flex-col rounded-lg border border-ink-700 bg-ink-900/40";

  return (
    <div ref={containerRef} className={wrapperClass} style={{ viewTransitionName: "pdf-reader" } as React.CSSProperties}>
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-800/60 px-2 py-1.5 text-xs">
        <button
          type="button"
          onClick={goPrev}
          disabled={pageNumber <= 1}
          className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
          title={t("pdf.previousPage", { defaultValue: "Previous page" }) ?? ""}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={pageNumber >= numPages}
          className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
          title={t("pdf.nextPage", { defaultValue: "Next page" }) ?? ""}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono tabular-nums text-ink-200">
          {pageNumber} / {numPages || "…"}
        </span>
        <form onSubmit={onJumpSubmit} className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder={t("pdf.jumpToPage", { defaultValue: "Go to" }) ?? ""}
            className="h-7 w-14 rounded border border-ink-700 bg-ink-900 px-2 text-center font-mono text-[10px] text-ink-200 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
          />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
            title={t("pdf.zoomOut", { defaultValue: "Zoom out" }) ?? ""}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setScale(FIT_WIDTH_SCALE)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
            title={t("pdf.fitWidth", { defaultValue: "Fit width" }) ?? ""}
          >
            <RectangleHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
            title={t("pdf.zoomIn", { defaultValue: "Zoom in" }) ?? ""}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
            title={
              (fullscreen
                ? t("pdf.exitFullscreen", { defaultValue: "Exit fullscreen" })
                : t("pdf.fullscreen", { defaultValue: "Fullscreen" })) ?? ""
            }
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 overflow-auto bg-ink-950 p-3">
        {blobUrl ? (
          <Document file={blobUrl} onLoadSuccess={onDocumentLoad} onLoadError={onDocumentLoadError}>
            <Page pageNumber={pageNumber} scale={scale} renderAnnotationLayer={false} renderTextLayer={false} />
          </Document>
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-ink-400">
            {t("common.loading", { defaultValue: "Loading…" })}
          </div>
        )}
      </div>
    </div>
  );
}
```

Notes:
- `renderAnnotationLayer={false}` and `renderTextLayer={false}` skip the optional layers — leaner render, no DOM noise. We can flip these on later if needed for selection / annotations.
- The `viewTransitionName: "pdf-reader"` stays on the wrapper across both `fullscreen=false` and `fullscreen=true` states so the View Transitions API morphs the box itself.
- Compact mode renders a fixed-width Page (`width` prop on `<Page>`) tied to the container's measured width. The Page in compact deliberately does NOT use `scale` because we want to fit the page to the mini-container, not zoom it.

- [ ] **Step 2: Type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
```

Expected: `exit=0`. If react-pdf's types complain about `Document` being shadowed (it's both the React component AND the global DOM type), rename the cast to `DocVT` accordingly — the code above already uses `Document as unknown as DocVT` to disambiguate.

Note: the line `type DocVT = Document & { startViewTransition?: ... };` in the toggleFullscreen function references the GLOBAL `Document` type — but in this file, `Document` is also imported from `react-pdf`. Disambiguate by importing the DOM Document type explicitly OR by using `globalThis.Document`:

```ts
const toggleFullscreen = () => {
  type DocVT = globalThis.Document & { startViewTransition?: (cb: () => void) => unknown };
  const doc = document as unknown as DocVT;
  // ...
};
```

If type-check fails, apply that fix.

- [ ] **Step 3: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/PdfReader.tsx
git commit -m "feat(card): add PdfReader component with toolbar + compact mode"
```

---

## Task 5: `CardSourceMedia` integration

**Files:**
- Modify: `frontend/src/components/CardSourceMedia.tsx`

The current component handles YouTube (line ~72), GitHub repo card (line ~140), and a catch-all "Open original" branch for article/wiki/pdf with `source_url`. Phase 2c routes PDF cards through `<PdfReader>` instead of the link.

- [ ] **Step 1: Update the props interface**

Locate the existing `Props` interface (probably around lines 19-25). Update:

```ts
import type { PdfReaderMode } from "./PdfReader";

interface Props {
  card: Card;
  fitHeight?: boolean;
  /** Forwarded to PdfReader (PDF cards only). Defaults to owner mode. */
  pdfMode?: PdfReaderMode;
  /** Forwarded to PdfReader as compact mini-on-scroll mode. */
  compact?: boolean;
}
```

Update the function signature:

```ts
export default function CardSourceMedia({ card, fitHeight = false, pdfMode, compact = false }: Props) {
```

- [ ] **Step 2: Add the PDF branch**

Find the YouTube branch (`if (card.source_type === "youtube" && card.external_id)` around line 72) and the article/wiki/pdf branch (`if (card.source_url && card.source_type !== "note")` around line 145). Insert a new branch between them:

```tsx
// PDF: render the inline reader. PdfReader handles its own load
// failures and falls back to an "Open original" link inline.
if (card.source_type === "pdf") {
  const resolvedMode: PdfReaderMode = pdfMode ?? { kind: "owner" };
  return <PdfReader card={card} mode={resolvedMode} compact={compact} />;
}
```

Add the import at the top of the file:

```ts
import PdfReader, { type PdfReaderMode } from "./PdfReader";
```

(If you already imported `type PdfReaderMode` from `./PdfReader` in Step 1, the import line is consolidated.)

- [ ] **Step 3: Type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
```

Expected: `exit=0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/CardSourceMedia.tsx
git commit -m "feat(card): route PDF source media through PdfReader"
```

---

## Task 6: `PathPlayerCardView` mini-on-scroll for PDF

**Files:**
- Modify: `frontend/src/components/PathPlayerCardView.tsx`

The component currently gates the IntersectionObserver-based pinning on YouTube. Extend to PDF, with a different mini-size variant.

- [ ] **Step 1: Extend `pinningEligible`**

Find the existing line (around line 110):

```ts
const pinningEligible = card?.source_type === "youtube" && !!card?.external_id;
```

Replace with:

```ts
const pinningEligible =
  (card?.source_type === "youtube" && !!card?.external_id) ||
  card?.source_type === "pdf";
```

- [ ] **Step 2: PDF mini-size variant**

The existing fixed-pinned class string assumes YouTube's 16:9 (`aspect-video w-80`). PDF needs portrait dimensions. Find the ternary that builds the wrapper className (around line 175):

```tsx
className={[
  "overflow-hidden rounded-md ring-1 transition-all duration-300 ease-out",
  isPinned
    ? "fixed right-4 top-24 z-30 aspect-video w-80 shadow-2xl ring-ink-700"
    : "absolute inset-0 ring-transparent",
].join(" ")}
```

Replace with:

```tsx
className={[
  "overflow-hidden rounded-md ring-1 transition-all duration-300 ease-out",
  isPinned
    ? card.source_type === "pdf"
      ? "fixed right-4 top-24 z-30 h-80 w-60 shadow-2xl ring-ink-700"
      : "fixed right-4 top-24 z-30 aspect-video w-80 shadow-2xl ring-ink-700"
    : "absolute inset-0 ring-transparent",
].join(" ")}
```

`h-80` = 320px, `w-60` = 240px → 240×320 portrait, close to A4's 1:1.4.

- [ ] **Step 3: Pass `pdfMode` and `compact` to `CardSourceMedia`**

Find the existing `<CardSourceMedia card={card} />` render. Replace:

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

The existing `playerMode` discriminated union (Phase 2a, Task 3) carries `username` + `slug` in the public branch — reuse it.

- [ ] **Step 4: Adjust the wrapper aspect for PDF unpinned state**

The non-pinned wrapper currently uses `aspect-video` to reserve 16:9 space. PDF needs a taller placeholder. Find the outer aspect-reservation div:

```tsx
<div className="relative aspect-video">
```

Replace with:

```tsx
<div className={`relative ${card.source_type === "pdf" ? "aspect-[3/4]" : "aspect-video"}`}>
```

`aspect-[3/4]` is a Tailwind arbitrary-value utility — produces a 3:4 box (close enough to letter / A4 for the unpinned reservation).

- [ ] **Step 5: Maximize button still works for PDF**

The existing Maximize-button JSX inside the pinned overlay was meant for YouTube. It should also appear for PDF mini. Verify the button is rendered unconditionally inside the `isPinned` branch (it should be — it's inside the same `<div>`). PdfReader's compact mode also has its own page-indicator overlay; the Maximize button on the OUTER wrapper still scrolls the user back to the top, which un-pins the wrapper, which un-compacts the PdfReader. No code change needed.

- [ ] **Step 6: Type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
```

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/PathPlayerCardView.tsx
git commit -m "feat(paths): mini-on-scroll for PDF cards"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/de.json`

- [ ] **Step 1: Add `pdf` namespace to `en.json`**

Inside the top-level JSON object (next to `paths`, `card`, etc.), add:

```json
"pdf": {
  "page": "Page",
  "of": "of",
  "previousPage": "Previous page",
  "nextPage": "Next page",
  "jumpToPage": "Go to",
  "zoomIn": "Zoom in",
  "zoomOut": "Zoom out",
  "fitWidth": "Fit width",
  "fullscreen": "Fullscreen",
  "exitFullscreen": "Exit fullscreen",
  "loadError": "Couldn't load the PDF",
  "openOriginal": "Open original"
},
```

- [ ] **Step 2: Add `pdf` namespace to `de.json`**

```json
"pdf": {
  "page": "Seite",
  "of": "von",
  "previousPage": "Vorherige Seite",
  "nextPage": "Nächste Seite",
  "jumpToPage": "Zu",
  "zoomIn": "Vergrößern",
  "zoomOut": "Verkleinern",
  "fitWidth": "Auf Breite anpassen",
  "fullscreen": "Vollbild",
  "exitFullscreen": "Vollbild verlassen",
  "loadError": "PDF konnte nicht geladen werden",
  "openOriginal": "Original öffnen"
},
```

- [ ] **Step 3: Validate JSON**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
python3 -c "
import json
en = json.load(open('frontend/src/locales/en.json'))['pdf']
de = json.load(open('frontend/src/locales/de.json'))['pdf']
keys = ['page','of','previousPage','nextPage','jumpToPage','zoomIn','zoomOut','fitWidth','fullscreen','exitFullscreen','loadError','openOriginal']
print('en missing:', [k for k in keys if k not in en])
print('de missing:', [k for k in keys if k not in de])
"
```

Expected: both lists empty.

- [ ] **Step 4: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "i18n(pdf): toolbar keys for the inline PDF reader"
```

---

## Task 8: Manual smoke walk + ship

**Files:** none (verification gate).

- [ ] **Step 1: Restart the stack**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
./scripts/stop.sh && ./scripts/start.sh
```

Wait for backend on :8001 and frontend on :5173. Tail logs if anything's odd: `tail -f .runtime/logs/backend.log`.

- [ ] **Step 2: Owner PDF — library card detail**

1. Sign in as `chris@example.com` / `testpass1234`.
2. Open a card with `source_type === "pdf"`. (If none exist, ingest one via `Add → PDF` from a sample PDF.)
3. The card-detail Source slot now shows the inline PdfReader with the toolbar.
4. Toolbar: Prev / Next / Page X / Y / Jump-to-page / Zoom -+/ Fit-width / Fullscreen — all clickable, all functional.
5. Keyboard: ←/→ navigates pages, +/- zooms, 0 resets to fit-width, Esc exits fullscreen.
6. Click Fullscreen → smoothly morphs to viewport-sized overlay; Esc returns.

- [ ] **Step 3: Owner PDF — path player**

1. Open an owner path that contains a PDF step.
2. The PDF reader appears in the source-media slot above the tab strip.
3. Scroll down → PDF wrapper pins to top-right, shrinks to 240×320, toolbar replaced by "Page X / Y" overlay.
4. Click Maximize → smooth scroll to top; PDF re-expands with full toolbar.

- [ ] **Step 4: Public consumer (anonymous)**

1. Sign out, open `/u/<username>/path/<slug>/play`.
2. PDF step renders the same reader (no auth → uses public file endpoint).
3. Mini-on-scroll works.
4. No `Authorization` header required for the file fetch — verify in Network tab.

- [ ] **Step 5: Public consumer (logged-in non-owner)**

1. Sign in as a different user, open the same public path.
2. PDF reader works, progress is saved (verify in DB).

- [ ] **Step 6: Edge cases**

1. Open a card whose PDF endpoint returns 404 (e.g., a card whose `original_file_id` was deleted from the DB) → reader shows the fallback "Open original" link to `source_url` if present, or the "Couldn't load the PDF" inline error.
2. Open the path-player on mobile width (devtools width <768 px) → mini-on-scroll is disabled (existing Phase 1 gate); PDF stays full width inline.

- [ ] **Step 7: Fast-forward main**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git checkout main && git merge --ff-only feat/path-player-phase-2c
git log --oneline -10
```

---

## Self-review

**Spec coverage:**
- §5.1 backend endpoint → Task 1 ✓
- §5.2 backend test → Task 1 ✓
- §6.1 deps → Task 2 ✓
- §6.2 worker config → Task 2 ✓
- §6.3 PdfReader component → Task 4 ✓
- §6.4 CardSourceMedia integration → Task 5 ✓
- §6.5 mini-on-scroll extension → Task 6 ✓
- §6.6 api.ts helpers → Task 3 ✓
- §6.7 i18n keys → Task 7 ✓
- §7 edge cases → Task 4 (fallback in PdfReader) + Task 8 (manual verification)

**Placeholder scan:** No TBDs. Each task has full code blocks.

**Type consistency:** `PdfReaderMode` type defined in Task 4, imported in Task 5, reused in Task 6. `card.source_type === "pdf"` check used consistently.

---

## Done criteria

- All 8 tasks ticked.
- Backend: 9/9 pytest passing (7 from earlier + 2 new).
- Frontend: `npx tsc -b --noEmit` exit 0.
- Manual smoke (Task 8 Steps 2–6) all green.
- No new tables, no migrations.
- Branch fast-forwarded to main.
