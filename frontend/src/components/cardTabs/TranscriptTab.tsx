import { ExternalLink, Search as SearchIcon, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { SkeletonLines } from "./Section";
import type { TranscriptOut, TranscriptSegment } from "../../lib/api";

interface TranscriptTabProps {
  /** `null` while loading, or a populated TranscriptOut. */
  transcript: TranscriptOut | null;
  /** YouTube video id when the source is a YouTube card — enables
   *  click-a-timestamp-to-jump-the-embedded-player. */
  youtubeVideoId?: string | null;
  /** Fallback open URL for non-YouTube segmented sources. */
  youtubeUrl?: string | null;
}

/**
 * Renders the transcript with per-line timestamps when the source has
 * them (YouTube). Each segment is a row: clickable timestamp on the
 * left, segment text on the right. Clicking a timestamp opens YouTube
 * at the exact second in a new tab.
 *
 * Search box at the top filters the visible segments and highlights
 * matches inline. For text-only sources without segments (PDF /
 * article) we keep the simple <pre>-style render so nothing breaks.
 */
export default function TranscriptTab({
  transcript,
  youtubeVideoId,
  youtubeUrl,
}: TranscriptTabProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const segments = transcript?.segments ?? null;
  const text = transcript?.text ?? "";

  const filteredSegments = useMemo<TranscriptSegment[] | null>(() => {
    if (!segments) return null;
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  // Click on a timestamp seeks the embedded player by writing the
  // `?t=` URL param. CardSourceMedia reads it. Only YouTube cards
  // support this — non-video segmented sources keep the external
  // link as a fallback so the timestamp still does *something*.
  const seekEmbeddedPlayer = useCallback(
    (start: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("t", String(Math.floor(start)));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const buildExternalLink = (start: number): string | null => {
    if (youtubeUrl && /youtube\.com|youtu\.be/i.test(youtubeUrl)) {
      const sep = youtubeUrl.includes("?") ? "&" : "?";
      return `${youtubeUrl}${sep}t=${Math.floor(start)}s`;
    }
    return null;
  };

  if (transcript === null) {
    return (
      <div className="text-sm leading-relaxed">
        <SkeletonLines />
      </div>
    );
  }

  // Non-segmented source — fall back to plain text render. No
  // timestamps to show.
  if (!segments || segments.length === 0) {
    return (
      <div className="text-sm leading-relaxed">
        <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink-200">
          {text}
        </pre>
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed">
      {/* Search bar — sticky at the top of the tab content so it stays
          visible when the user scrolls through a long transcript. */}
      <div className="sticky top-0 z-[1] mb-3 -mx-1 bg-ink-900/95 px-1 pb-2 pt-1 backdrop-blur dark:bg-ink-900/95">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("card.transcriptSearch", {
              defaultValue: "Search the transcript…",
            }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-800/60 py-1.5 pl-8 pr-8 text-xs text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-500 hover:bg-ink-700 hover:text-ink-100"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {query && (
          <p className="mt-1 px-1 text-[10px] text-ink-500">
            {t("card.transcriptHits", {
              count: filteredSegments?.length ?? 0,
              defaultValue: `${filteredSegments?.length ?? 0} matches`,
            })}
          </p>
        )}
      </div>

      {filteredSegments && filteredSegments.length > 0 ? (
        <ol className="space-y-1.5">
          {filteredSegments.map((seg, idx) => {
            const externalLink = buildExternalLink(seg.start);
            return (
              <li key={`${seg.start}-${idx}`} className="flex gap-3">
                {youtubeVideoId ? (
                  <button
                    type="button"
                    onClick={() => seekEmbeddedPlayer(seg.start)}
                    className="flex-shrink-0 font-mono text-[11px] tabular-nums text-fuchsia-400 hover:underline dark:text-fuchsia-300"
                    title={t("card.openAtTimestamp", {
                      defaultValue: "Jump to this timestamp",
                    }) ?? ""}
                  >
                    {formatTimestamp(seg.start)}
                  </button>
                ) : externalLink ? (
                  <a
                    href={externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 font-mono text-[11px] tabular-nums text-fuchsia-400 hover:underline dark:text-fuchsia-300"
                    title={t("card.openAtTimestamp", {
                      defaultValue: "Open at this timestamp",
                    }) ?? ""}
                  >
                    {formatTimestamp(seg.start)}
                  </a>
                ) : (
                  <span className="flex-shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                    {formatTimestamp(seg.start)}
                  </span>
                )}
                <span className="flex-1 text-ink-200">
                  {query ? highlightMatches(seg.text, query) : seg.text}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-1 py-4 text-xs text-ink-500">
          {t("card.transcriptNoMatch", {
            defaultValue: "No segments match your search.",
          })}
        </p>
      )}
    </div>
  );
}

/** Format seconds as `mm:ss` or `hh:mm:ss` for hour-long videos. */
function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Wrap matches in a <mark> so the user can spot the hit immediately. */
function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const re = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark
        key={i}
        className="rounded bg-fuchsia-500/30 px-0.5 text-fuchsia-100 dark:bg-fuchsia-500/30 dark:text-fuchsia-50"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
  // Reset the regex after split-test loop — the same RegExp instance
  // would otherwise get sticky between calls inside this render.
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* `Open in YouTube ↗` link below the transcript when applicable */
export function TranscriptYouTubeLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100"
    >
      Open on YouTube
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
