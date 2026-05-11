/**
 * Poll the version history of a post's images while any of them is
 * still being rendered by gpt-image-2. Fires user-facing toasts on
 * status transitions (processing → ready / failed) so the user gets
 * feedback even after closing the modal that started the job.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type PostImageVersion, type SocialPostOut } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

const POLL_INTERVAL_MS = 4000;

export function usePostImageVersions(
  cardId: string,
  post: SocialPostOut,
  onPostChanged: (next: SocialPostOut) => void,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const [versions, setVersions] = useState<PostImageVersion[]>([]);
  const previousStatusRef = useRef<Map<string, string>>(new Map());
  // Track which version ids have a sticky "loading" toast so we update
  // the same id in place instead of stacking three of them.
  const toastIdsRef = useRef<Map<string, string>>(new Map());

  const fetchOnce = useCallback(async () => {
    try {
      const rows = await api.listPostImageVersions(cardId, post.id);
      setVersions(rows);
      return rows;
    } catch {
      return null;
    }
  }, [cardId, post.id]);

  // Fire toasts on status transitions.
  useEffect(() => {
    const prev = previousStatusRef.current;
    const next = new Map<string, string>();
    versions.forEach((v) => {
      next.set(v.id, v.status);
      const oldStatus = prev.get(v.id);
      const toastId = toastIdsRef.current.get(v.id);
      if (oldStatus === "processing" && v.status === "ready") {
        const id = toastId ?? `image-${v.id}`;
        toast.show({
          id,
          kind: "success",
          message:
            v.kind === "refine"
              ? t("toasts.imageRefined", {
                  defaultValue: "Image refined and ready.",
                }) ?? "Image refined and ready."
              : t("toasts.imageGenerated", {
                  defaultValue: "Image generated and ready.",
                }) ?? "Image generated and ready.",
        });
        toastIdsRef.current.delete(v.id);
      } else if (oldStatus === "processing" && v.status === "failed") {
        const id = toastId ?? `image-${v.id}`;
        toast.show({
          id,
          kind: "error",
          message:
            (t("toasts.imageFailed", {
              defaultValue: "Image generation failed",
            }) ?? "Image generation failed") +
            (v.error_message ? `: ${v.error_message}` : ""),
        });
        toastIdsRef.current.delete(v.id);
      }
    });
    previousStatusRef.current = next;
  }, [versions, toast, t]);

  // When all processing jobs finish, refetch the post so its
  // image_file_id / image_url reflects the newly-active version.
  const hadProcessingRef = useRef(false);
  useEffect(() => {
    const anyProcessing = versions.some((v) => v.status === "processing");
    if (hadProcessingRef.current && !anyProcessing) {
      void (async () => {
        try {
          const fresh = await api.listSocialPosts(cardId);
          const match = fresh.find((p) => p.id === post.id);
          if (match) onPostChanged(match);
        } catch {
          // Non-fatal — user can refresh manually if needed.
        }
      })();
    }
    hadProcessingRef.current = anyProcessing;
  }, [versions, cardId, post.id, onPostChanged]);

  // Initial fetch — once per (cardId, postId).
  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  // While any version is processing, schedule a next fetch. When the
  // last processing row flips ready/failed, this effect re-runs and
  // returns without scheduling — polling stops naturally.
  useEffect(() => {
    const anyProcessing = versions.some((v) => v.status === "processing");
    if (!anyProcessing) return undefined;
    const handle = window.setTimeout(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(handle);
  }, [versions, fetchOnce]);

  /** Called by the modals after kicking off a job so the pending row
   *  shows up in `versions` immediately, alongside a sticky "loading"
   *  toast — the user can close the modal and stay informed. */
  const registerPending = useCallback(
    (pending: PostImageVersion, loadingMessage: string) => {
      setVersions((prev) => [pending, ...prev]);
      const toastId = `image-${pending.id}`;
      toastIdsRef.current.set(pending.id, toastId);
      previousStatusRef.current.set(pending.id, "processing");
      toast.show({
        id: toastId,
        kind: "loading",
        message: loadingMessage,
        duration: null,
      });
    },
    [toast],
  );

  return { versions, refresh: fetchOnce, registerPending };
}
