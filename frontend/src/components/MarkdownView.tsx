import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

interface Props {
  source: string;
  className?: string;
  /** When set, `[t=NN]` markers in the source are rewritten to
   *  clickable timestamp pills that open the video at that second.
   *  Pass the YouTube video id (preferred) and/or the full source URL
   *  as a fallback for non-YouTube hosts. */
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  /** When provided, timestamp pills become in-app buttons that call
   *  this handler with the seconds value instead of opening YouTube
   *  in a new tab. The card-detail page wires this to update the
   *  `?t=` URL param so the embedded player seeks to that second. */
  onTimestampClick?: (seconds: number) => void;
}

// Configure once at module load.
marked.setOptions({
  breaks: true, // single line breaks become <br>
  gfm: true,
});

/**
 * Renders markdown to styled HTML. Uses `marked` for the parse step and
 * tailwind utility classes for the typography. The output is wrapped in
 * a sandbox-ish container — links open in a new tab, headings are
 * scaled down so they don't compete with the page H1.
 */
export default function MarkdownView({
  source,
  className,
  youtubeVideoId,
  youtubeUrl,
  onTimestampClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inApp = typeof onTimestampClick === "function";

  const html = useMemo(() => {
    if (!source?.trim()) return "";
    // Pre-process timestamp markers BEFORE markdown parsing so the
    // resulting <a> tags survive marked's transformation untouched.
    const withTimestamps = renderTimestampMarkers(
      source,
      youtubeVideoId,
      youtubeUrl,
      inApp,
    );
    return marked.parse(withTimestamps, { async: false }) as string;
  }, [source, youtubeVideoId, youtubeUrl, inApp]);

  // Delegate clicks on `.ts-marker` pills to onTimestampClick when the
  // host page wants to handle navigation in-app (no new tab).
  useEffect(() => {
    if (!onTimestampClick) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const pill = target?.closest?.("a.ts-marker") as HTMLAnchorElement | null;
      if (!pill) return;
      const raw = pill.getAttribute("data-t");
      if (!raw) return;
      const secs = parseInt(raw, 10);
      if (!Number.isFinite(secs)) return;
      e.preventDefault();
      onTimestampClick(secs);
    };
    node.addEventListener("click", handler);
    return () => node.removeEventListener("click", handler);
  }, [onTimestampClick, html]);

  if (!html) return null;

  return (
    <div
      ref={containerRef}
      className={[
        "markdown-body text-sm leading-relaxed text-ink-200",
        className ?? "",
      ].join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Replace `[t=NN]` markers (NN = seconds from start) with anchor tags
 * pointing at the source video at that timestamp. Returns the source
 * unchanged when no link target is available — the marker stays
 * visible-but-inert rather than being silently stripped, so the user
 * still sees that the AI referenced a moment.
 */
function renderTimestampMarkers(
  source: string,
  videoId?: string | null,
  url?: string | null,
  inApp = false,
): string {
  return source.replace(/\[t=(\d+)\]/g, (_, secsStr: string) => {
    const secs = parseInt(secsStr, 10);
    if (!Number.isFinite(secs)) return `[t=${secsStr}]`;
    const label = formatTimestamp(secs);
    if (inApp) {
      // In-app pill: a click handler attached by MarkdownView reads
      // `data-t` and seeks the embedded player. Keep an href as a
      // sensible right-click fallback when a YouTube link is known.
      const fallback =
        videoId
          ? `https://www.youtube.com/watch?v=${videoId}&t=${secs}s`
          : url && /youtube\.com|youtu\.be/i.test(url)
            ? `${url}${url.includes("?") ? "&" : "?"}t=${secs}s`
            : "#";
      return `<a class="ts-marker" data-t="${secs}" href="${fallback}">▶ ${label}</a>`;
    }
    let href: string | null = null;
    if (videoId) {
      href = `https://www.youtube.com/watch?v=${videoId}&t=${secs}s`;
    } else if (url && /youtube\.com|youtu\.be/i.test(url)) {
      const sep = url.includes("?") ? "&" : "?";
      href = `${url}${sep}t=${secs}s`;
    }
    if (!href) return `[${label}]`;
    return `<a class="ts-marker" href="${href}" target="_blank" rel="noopener noreferrer">▶ ${label}</a>`;
  });
}

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

/** Strip markdown-ish syntax to a plain-text approximation. */
export function markdownToPlainText(md: string): string {
  if (!md) return "";
  return md
    // fenced code blocks → keep content, drop fences
    .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, "$1")
    // images ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // inline code `x` → x
    .replace(/`([^`]+)`/g, "$1")
    // bold/italic markers
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // strikethrough
    .replace(/~~(.*?)~~/g, "$1")
    // timestamp markers — keep just the time so plain-text copies still
    // make sense ("Algorithms detect fraud [01:25]")
    .replace(/\[t=(\d+)\]/g, (_, s: string) => {
      const secs = parseInt(s, 10);
      if (!Number.isFinite(secs)) return `[t=${s}]`;
      const mm = Math.floor(secs / 60);
      const ss = secs % 60;
      return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}]`;
    })
    // blockquote markers
    .replace(/^\s{0,3}>\s?/gm, "")
    // headings
    .replace(/^#{1,6}\s+/gm, "")
    // horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // list bullets
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    // collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
