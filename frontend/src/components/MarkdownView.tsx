import { marked } from "marked";
import { useMemo } from "react";

interface Props {
  source: string;
  className?: string;
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
export default function MarkdownView({ source, className }: Props) {
  const html = useMemo(() => {
    if (!source?.trim()) return "";
    return marked.parse(source, { async: false }) as string;
  }, [source]);

  if (!html) return null;

  return (
    <div
      className={[
        "markdown-body text-sm leading-relaxed text-ink-200",
        className ?? "",
      ].join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
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
