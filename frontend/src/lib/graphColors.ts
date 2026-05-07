/**
 * Helpers for colouring graph nodes by source-type or by tag.
 *
 * Tag colours are derived deterministically from a hash of the tag name,
 * so the same tag always gets the same colour across renders. The palette
 * is curated to look good on the dark canvas.
 */

export const SOURCE_COLORS: Record<string, string> = {
  youtube: "#f87171",
  article: "#60a5fa",
  pdf: "#34d399",
};

const TAG_PALETTE = [
  "#f87171", // red
  "#fb923c", // orange
  "#fbbf24", // amber
  "#a3e635", // lime
  "#34d399", // emerald
  "#22d3ee", // cyan
  "#60a5fa", // blue
  "#818cf8", // indigo
  "#a78bfa", // violet
  "#e879f9", // fuchsia
  "#f472b6", // pink
  "#fda4af", // rose
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorForTag(tag: string): string {
  return TAG_PALETTE[hashString(tag) % TAG_PALETTE.length];
}

export type ColorMode = "source" | "tag";

export function nodeColor(
  mode: ColorMode,
  sourceType: string,
  tags: string[],
): string {
  if (mode === "tag" && tags.length > 0) {
    // Pick the tag whose hash gives the lowest palette slot — deterministic
    // and gives "primary" tags a stable colour even when more are added later.
    const sorted = [...tags].sort();
    return colorForTag(sorted[0]);
  }
  return SOURCE_COLORS[sourceType] ?? "#a78bfa";
}
