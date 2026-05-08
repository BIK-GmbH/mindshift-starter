/**
 * Helpers for colouring graph nodes by source-type or by tag.
 *
 * Tag colours are derived deterministically from a hash of the tag name,
 * so the same tag always gets the same colour across renders. The palette
 * is curated to look good on the dark canvas.
 */

// "Curated Tonal" palette — perceptually balanced, IBM-Carbon /
// Solarized-inspired. Same lightness across all hues so no single tag
// shouts louder than the others; reads as a research-grade graph
// rather than a Disco floor.
export const SOURCE_COLORS: Record<string, string> = {
  youtube: "#dc8a7d",
  article: "#7da7dc",
  pdf: "#7dbf9c",
};

const TAG_PALETTE = [
  "#cb6e6e", // muted red
  "#d18a4f", // burnt orange
  "#cda94e", // ochre
  "#a4be59", // moss
  "#5fb88a", // sage
  "#5dabb5", // teal
  "#6f93c9", // dusk blue
  "#7e7dc7", // periwinkle
  "#a07dc7", // muted violet
  "#c46fb4", // mauve
  "#cb6e8e", // dusty pink
  "#c97385", // rose
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
  return SOURCE_COLORS[sourceType] ?? "#a07dc7";
}
