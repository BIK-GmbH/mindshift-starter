/**
 * Tiny imperative helper that mirrors `<meta>` tags into `document.head`
 * for browser-side bots that DO execute JavaScript (Slack's modern
 * preview, some search engines). Server-side OG (see `backend/app/api/og.py`)
 * stays the source of truth for crawlers without JS.
 *
 * Usage:
 *   useEffect(() => {
 *     const cleanup = setMetaTags({
 *       "og:title": "…",
 *       "og:description": "…",
 *       "og:image": "…",
 *       "twitter:card": "summary_large_image",
 *     });
 *     return cleanup;
 *   }, [...]);
 */

type Tag = { key: "name" | "property"; value: string };

function tagFor(name: string): Tag {
  return name.startsWith("og:") ? { key: "property", value: name } : { key: "name", value: name };
}

export function setMetaTags(meta: Record<string, string | null | undefined>): () => void {
  const created: HTMLMetaElement[] = [];
  const overwritten: { el: HTMLMetaElement; previous: string }[] = [];

  for (const [name, value] of Object.entries(meta)) {
    if (!value) continue;
    const { key, value: attrValue } = tagFor(name);
    const selector = `meta[${key}="${attrValue}"]`;
    let el = document.head.querySelector<HTMLMetaElement>(selector);
    if (el) {
      overwritten.push({ el, previous: el.content });
      el.content = value;
    } else {
      el = document.createElement("meta");
      el.setAttribute(key, attrValue);
      el.content = value;
      document.head.appendChild(el);
      created.push(el);
    }
  }

  return () => {
    for (const el of created) el.remove();
    for (const { el, previous } of overwritten) el.content = previous;
  };
}
