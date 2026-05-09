/**
 * Anonymous progress tracking for public learning paths.
 *
 * Public paths don't require login, so we can't write to the
 * authenticated `path_progress` table. Instead we keep a per-path
 * set of completed step indices in localStorage. Survives reloads,
 * is per-device + per-browser, never leaves the client.
 *
 * Key shape: `mindshift.publicPathProgress.{username}/{slug}` →
 * `[0, 2, 3]` (JSON array of completed 0-based step indices).
 */

const PREFIX = "mindshift.publicPathProgress.";

function key(username: string, slug: string): string {
  return `${PREFIX}${username}/${slug}`;
}

export function loadCompleted(username: string, slug: string): Set<number> {
  try {
    const raw = localStorage.getItem(key(username, slug));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is number => typeof n === "number"));
  } catch {
    return new Set();
  }
}

export function saveCompleted(
  username: string,
  slug: string,
  completed: Set<number>,
): void {
  try {
    const arr = Array.from(completed).sort((a, b) => a - b);
    localStorage.setItem(key(username, slug), JSON.stringify(arr));
  } catch {
    /* localStorage may be disabled — no-op */
  }
}

export function clearCompleted(username: string, slug: string): void {
  try {
    localStorage.removeItem(key(username, slug));
  } catch {
    /* no-op */
  }
}
