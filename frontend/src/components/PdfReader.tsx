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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    card.id,
    card.original_file_id,
    mode.kind,
    mode.kind === "public" ? mode.username : null,
    mode.kind === "public" ? mode.slug : null,
  ]);

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
    type DocVT = globalThis.Document & { startViewTransition?: (cb: () => void) => unknown };
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
