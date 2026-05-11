import {
  ImageIcon,
  Loader2,
  Send,
  Sparkles,
  X,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { api, type PostImageVersion, type SocialPostOut } from "../../lib/api";
import { useAuthedImage } from "../../lib/useAuthedImage";

/**
 * Refine-Modus: centred modal showing the active image, a prompt input,
 * and the version-history strip. The actual refine call is async — the
 * modal kicks off a job and closes; the parent's polling hook owns the
 * toast notifications + post refresh. Clicking any prior version makes
 * it the active one (instant — files stay in storage, so it doubles as
 * undo).
 */
export function PostImageRefineModal({
  cardId,
  post,
  versions,
  onClose,
  onUpdated,
  onJobStarted,
}: {
  cardId: string;
  post: SocialPostOut;
  /** Live versions from the parent's polling hook. */
  versions: PostImageVersion[];
  onClose: () => void;
  onUpdated: (next: SocialPostOut) => void;
  onJobStarted: (pending: PostImageVersion, loadingMessage: string) => void;
}) {
  const { t } = useTranslation();
  const { src: activeImageSrc } = useAuthedImage(post.image_url);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isJobInFlight = versions.some((v) => v.status === "processing");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submitRefine = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const pending = await api.refinePostImage(cardId, post.id, prompt.trim());
      onJobStarted(
        pending,
        t("toasts.imageRefining", {
          defaultValue:
            "Refining image — you can close this and we'll let you know when it's done.",
        }) ?? "Refining image…",
      );
      setPrompt("");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const activateVersion = async (versionId: string) => {
    setActivating(versionId);
    setError(null);
    try {
      const next = await api.activatePostImageVersion(cardId, post.id, versionId);
      onUpdated(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivating(null);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("posts.refine.title", { defaultValue: "Refine image" }) ?? ""}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md"
        aria-label={t("common.close") ?? "Close"}
      />

      <div className="relative flex h-[100vh] w-[100vw] max-h-none max-w-none flex-col overflow-hidden border-0 bg-ink-800 surface-elevated sm:h-[85vh] sm:w-[920px] sm:max-h-[85vh] sm:max-w-[92vw] sm:rounded-2xl sm:border sm:border-ink-700 sm:shadow-2xl">
        {/* Top bar */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
            <Wand2 className="h-4 w-4 text-violet-400" />
            {t("posts.refine.title", { defaultValue: "Refine image" })}
            <span className="text-ink-500">·</span>
            <span className="text-xs font-normal text-ink-400">
              {versions.length} {t("posts.refine.versions", { defaultValue: "versions" })}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100"
            aria-label={t("common.close") ?? "Close"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Main image area */}
        <div className="relative flex flex-1 min-h-0 items-center justify-center overflow-auto bg-ink-900/40 p-6">
          {activeImageSrc ? (
            <img
              src={activeImageSrc}
              alt=""
              className="max-h-full max-w-full rounded-lg border border-ink-700 shadow-2xl"
            />
          ) : (
            <div className="text-sm text-ink-400">
              <ImageIcon className="mx-auto h-12 w-12 opacity-40" />
              <p className="mt-2">
                {t("posts.refine.noImage", { defaultValue: "No image to refine yet." })}
              </p>
            </div>
          )}
          {isJobInFlight && (
            <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full bg-violet-500/25 px-3 py-1 text-[11px] font-medium text-violet-100 backdrop-blur">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("posts.refine.inFlight", {
                defaultValue: "Refinement in progress",
              })}
            </div>
          )}
        </div>

        {/* Refine input */}
        <div className="flex-shrink-0 border-t border-ink-700 px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !submitting) {
                  e.preventDefault();
                  void submitRefine();
                }
              }}
              placeholder={
                t("posts.refine.placeholder", {
                  defaultValue:
                    "What should change? e.g. 'Make headline orange. Remove the bottom source line.'",
                }) ?? ""
              }
              disabled={submitting}
              className="flex-1 rounded-md border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-violet-400 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitRefine()}
              disabled={submitting || !prompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("posts.refine.send", { defaultValue: "Refine" })}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-ink-500">
            {t("posts.refine.hint", {
              defaultValue:
                "Sends the current image + your prompt to gpt-image-2 (images.edit). The job runs in the background — close anytime and we'll notify when it's ready.",
            })}
          </p>
        </div>

        {/* Version strip */}
        {versions.length > 0 && (
          <div className="flex-shrink-0 border-t border-ink-700 bg-ink-800/60 px-5 py-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-400">
              <Sparkles className="h-3 w-3" />
              {t("posts.refine.history", { defaultValue: "Version history" })}
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {versions.map((v) => {
                // Derive is_active CLIENT-SIDE from whether this
                // version's file matches the post's currently-active
                // file. The server-supplied `is_active` is only
                // refreshed when polling runs — and polling stops as
                // soon as no version is `processing`. That meant
                // after switching A→B via the version strip, A still
                // had the stale `is_active=true` flag and its button
                // stayed disabled, so the user couldn't click it
                // back. Deriving from post.image_url makes the strip
                // react to activation instantly.
                const isActive =
                  v.image_url !== null && v.image_url === post.image_url;
                return (
                  <VersionThumb
                    key={v.id}
                    version={{ ...v, is_active: isActive }}
                    disabled={activating === v.id || submitting}
                    isActivating={activating === v.id}
                    onClick={() =>
                      !isActive &&
                      v.status === "ready" &&
                      void activateVersion(v.id)
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function VersionThumb({
  version,
  disabled,
  isActivating,
  onClick,
}: {
  version: PostImageVersion;
  disabled: boolean;
  isActivating: boolean;
  onClick: () => void;
}) {
  const { src } = useAuthedImage(version.image_url);
  const { t } = useTranslation();
  const kindLabel =
    version.status === "processing"
      ? t("posts.refine.kindProcessing", { defaultValue: "…rendering" })
      : version.status === "failed"
        ? t("posts.refine.kindFailed", { defaultValue: "Failed" })
        : version.kind === "refine"
          ? t("posts.refine.kindRefine", { defaultValue: "Refine" })
          : t("posts.refine.kindGenerate", { defaultValue: "Generated" });
  const isPending = version.status === "processing";
  const isFailed = version.status === "failed";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || version.is_active || isPending || isFailed}
      title={version.error_message ?? version.prompt_used ?? kindLabel}
      className={[
        "relative shrink-0 overflow-hidden rounded-md border-2 transition",
        version.is_active
          ? "border-violet-400 ring-2 ring-violet-400/40"
          : isPending
            ? "border-violet-500/40"
            : isFailed
              ? "border-red-500/40"
              : "border-ink-700 hover:border-ink-500",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {src ? (
        <img src={src} alt="" className="block h-20 w-20 object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center bg-ink-800 text-ink-500">
          {isFailed ? (
            <X className="h-4 w-4 text-red-400" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </div>
      )}
      {isActivating && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/70">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </div>
      )}
      <span className="absolute bottom-0 left-0 right-0 bg-ink-900/80 px-1 py-0.5 text-[9px] text-ink-200">
        {kindLabel}
      </span>
    </button>
  );
}
