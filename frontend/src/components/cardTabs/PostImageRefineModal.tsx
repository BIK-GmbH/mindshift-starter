import {
  ImageIcon,
  Loader2,
  Send,
  Sparkles,
  X,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { api, type PostImageVersion, type SocialPostOut } from "../../lib/api";
import { useAuthedImage } from "../../lib/useAuthedImage";

/**
 * Refine-Modus: fullscreen view of the current image with a refinement
 * prompt input and a version-history strip. Clicking any prior version
 * makes it the active one (instant — the underlying files stay in
 * storage so it's effectively undo).
 */
export function PostImageRefineModal({
  cardId,
  post,
  onClose,
  onUpdated,
}: {
  cardId: string;
  post: SocialPostOut;
  onClose: () => void;
  onUpdated: (next: SocialPostOut) => void;
}) {
  const { t } = useTranslation();
  const { src: activeImageSrc } = useAuthedImage(post.image_url);
  const [versions, setVersions] = useState<PostImageVersion[]>([]);
  const [prompt, setPrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const rows = await api.listPostImageVersions(cardId, post.id);
      setVersions(rows);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId, post.id]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submitRefine = async () => {
    if (!prompt.trim()) return;
    setRefining(true);
    setError(null);
    try {
      const next = await api.refinePostImage(cardId, post.id, prompt.trim());
      onUpdated(next);
      setPrompt("");
      await loadVersions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefining(false);
    }
  };

  const activateVersion = async (versionId: string) => {
    setActivating(versionId);
    setError(null);
    try {
      const next = await api.activatePostImageVersion(cardId, post.id, versionId);
      onUpdated(next);
      await loadVersions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivating(null);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink-900/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t("posts.refine.title", { defaultValue: "Refine image" }) ?? ""}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
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
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        {refining ? (
          <div className="flex flex-col items-center gap-3 text-ink-300">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <p className="text-sm">
              {t("posts.refine.applying", {
                defaultValue: "Applying your refinement — this takes ~30 s…",
              })}
            </p>
          </div>
        ) : activeImageSrc ? (
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
      </div>

      {/* Refine input */}
      <div className="border-t border-ink-700 px-5 py-3">
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
              if (e.key === "Enter" && !e.shiftKey && !refining) {
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
            disabled={refining}
            className="flex-1 rounded-md border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-violet-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void submitRefine()}
            disabled={refining || !prompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
          >
            {refining ? (
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
              "Sends the current image + your prompt to gpt-image-2 (images.edit). The prior version stays in history below.",
          })}
        </p>
      </div>

      {/* Version strip */}
      {versions.length > 0 && (
        <div className="border-t border-ink-700 bg-ink-800/60 px-5 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-400">
            <Sparkles className="h-3 w-3" />
            {t("posts.refine.history", { defaultValue: "Version history" })}
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {versions.map((v) => (
              <VersionThumb
                key={v.id}
                version={v}
                disabled={activating === v.id || refining}
                isActivating={activating === v.id}
                onClick={() => !v.is_active && void activateVersion(v.id)}
              />
            ))}
          </div>
        </div>
      )}
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
    version.kind === "refine"
      ? t("posts.refine.kindRefine", { defaultValue: "Refine" })
      : t("posts.refine.kindGenerate", { defaultValue: "Generated" });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || version.is_active}
      title={version.prompt_used ?? kindLabel}
      className={[
        "relative shrink-0 overflow-hidden rounded-md border-2 transition",
        version.is_active
          ? "border-violet-400 ring-2 ring-violet-400/40"
          : "border-ink-700 hover:border-ink-500",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {src ? (
        <img src={src} alt="" className="block h-20 w-20 object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center bg-ink-800 text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
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
