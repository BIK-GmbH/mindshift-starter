/* URL canonicalisation — single source of truth for what counts as
 * "the same page" anywhere in the extension.
 *
 * Goals:
 *  1. Make dedup robust against tracking junk (utm_*, fbclid, …).
 *  2. Collapse YouTube URL variants (youtu.be/<id>, youtube.com/watch?v=<id>&...)
 *     to one canonical form so re-saving from the share menu vs. the
 *     watch page hits the same card.
 *  3. Stay 1:1 with `backend/app/services/url_normalize.py`. Tests
 *     enforce that — same input → same output on both sides.
 *
 * Pure ES module, no chrome.* dependency, so it works in popup,
 * sidepanel, content scripts, AND the MV3 service worker.
 */

const TRACKING_PARAMS = new Set([
  // utm_* handled by prefix match below
  "gclid",
  "fbclid",
  "msclkid",
  "mc_eid",
  "mc_cid",
  "ref",
  "ref_src",
  "ref_url",
  "igshid",
  "s", // twitter share id; Twitter uses 's' as the share-source
  "__s",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "vero_conv",
  "yclid",
  "oly_anon_id",
  "oly_enc_id",
  "spm",
]);

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

/** Extract a YouTube video id from any of the URL shapes Google ships. */
function extractYouTubeId(u) {
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be") {
    return u.pathname.slice(1).split("/")[0] || null;
  }
  if (YT_HOSTS.has(host)) {
    if (u.pathname === "/watch") {
      return u.searchParams.get("v");
    }
    // /shorts/<id> or /embed/<id>
    const m = u.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Canonicalise a URL.
 *
 * Returns the input untouched if it is not a parseable absolute URL —
 * callers may pass note:// pseudo-URLs and other non-http strings, and
 * we don't want to lose them.
 */
export function canonicalizeUrl(input) {
  if (typeof input !== "string" || !input) return input;
  let u;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return input;

  // YouTube short-circuit: collapse every supported shape to the
  // canonical watch URL. Drop everything except a `t=` timestamp,
  // because timestamps carry meaning (saved-at-second bookmarks).
  const ytId = extractYouTubeId(u);
  if (ytId) {
    const params = new URLSearchParams();
    params.set("v", ytId);
    const t = u.searchParams.get("t") || u.searchParams.get("start");
    if (t) params.set("t", t);
    return `https://www.youtube.com/watch?${params.toString()}`;
  }

  // Lowercase scheme + host.
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // Drop default ports.
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }

  // Strip tracking params: explicit list + every key starting with `utm_`.
  const keep = [];
  for (const [k, v] of u.searchParams) {
    const kl = k.toLowerCase();
    if (kl.startsWith("utm_")) continue;
    if (TRACKING_PARAMS.has(kl)) continue;
    keep.push([k, v]);
  }
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);

  // Drop fragment unless it carries content. Empty `#` strings round-trip
  // weirdly across libraries, so collapse to none.
  if (u.hash === "#" || u.hash === "") u.hash = "";

  // Drop a single trailing slash on the root path only — deeper paths
  // keep theirs because some servers (Apache /pages/ vs /pages) treat
  // them as distinct resources.
  let s = u.toString();
  if (u.pathname === "/" && s.endsWith("/")) {
    // URL toString always renders a trailing slash for root; remove if
    // there is no query and no fragment.
    if (!u.search && !u.hash) {
      s = s.slice(0, -1);
    }
  }
  return s;
}
