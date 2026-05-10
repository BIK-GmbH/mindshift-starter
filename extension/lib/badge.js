/* Pure helpers for the toolbar-badge state machine. Kept separate
 * from background.js so the staleness logic is testable in Node
 * without a chrome.* shim.
 */

/** Badge cache TTL in ms — after this, force a re-fetch even when
 *  the URL hasn't changed. Catches the case where the user just
 *  saved the page in another window (the server now has a card the
 *  cache says doesn't exist). 60 s is a compromise between freshness
 *  and avoiding chatter on tab-flicking sessions.
 */
export const BADGE_CACHE_MS = 60_000;

/** Decide whether the cached entry for a tab is still good or needs
 *  a re-fetch. Pure function, no side effects.
 *
 *  @param {{ url:string, ts:number }|null|undefined} entry  prior cache hit
 *  @param {string}                                  currentUrl  canonicalised
 *  @param {number}                                  nowMs       Date.now()
 */
export function shouldRefetch(entry, currentUrl, nowMs) {
  if (!entry) return true;
  if (!currentUrl) return false; // nothing to do
  if (entry.url !== currentUrl) return true;
  if (typeof entry.ts !== "number") return true;
  return nowMs - entry.ts > BADGE_CACHE_MS;
}
