import { useEffect, useState } from "react";

import { tokenStorage } from "./api";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Render a private image endpoint (e.g. `/api/paths/{id}/cover.png`)
 * inside an `<img>` tag. The browser can't attach the `Authorization`
 * header to a vanilla `<img src=>` request, so we fetch the bytes
 * ourselves and produce an `object:` URL the tag can consume.
 *
 * Returns:
 *   - the object URL (or null while loading / on failure)
 *   - a refresh callback if the caller wants to retry after a known
 *     content change (e.g. just regenerated the cover).
 */
export function useAuthedImage(url: string | null): {
  src: string | null;
  refresh: () => void;
} {
  const [src, setSrc] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;

    void (async () => {
      try {
        const token = tokenStorage.get();
        const response = await fetch(`${BASE_URL}${url}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          if (!cancelled) setSrc(null);
          return;
        }
        const blob = await response.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setSrc(createdUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, bump]);

  return { src, refresh: () => setBump((n) => n + 1) };
}
