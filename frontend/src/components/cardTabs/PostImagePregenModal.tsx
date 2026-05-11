import {
  ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  api,
  type ImageTemplateOut,
  type PostImagePreview,
  type PostImageVersion,
  type SocialPostOut,
} from "../../lib/api";

const TEMPLATE_VAR_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR_RE, (match, varName) => {
    if (varName in values) return values[varName];
    return match;
  });
}

/**
 * Pre-Gen modal: lets the user inspect (and override) every variable
 * value the AI extracted, switch to "full prompt" mode for raw control,
 * then commit a generation against gpt-image-2.
 */
export function PostImagePregenModal({
  cardId,
  post,
  templates,
  onClose,
  onJobStarted,
}: {
  cardId: string;
  post: SocialPostOut;
  templates: ImageTemplateOut[];
  onClose: () => void;
  /** Job kicked off (status="processing"). Modal closes; parent's
   *  polling hook owns the user-facing notifications. */
  onJobStarted: (pending: PostImageVersion, loadingMessage: string) => void;
}) {
  const { t } = useTranslation();
  const defaultTemplate =
    templates.find((tpl) => tpl.is_default) ?? templates[0] ?? null;
  const [templateId, setTemplateId] = useState<string | null>(
    defaultTemplate?.id ?? null,
  );
  const template = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? null,
    [templates, templateId],
  );

  const [tab, setTab] = useState<"vars" | "full">("vars");
  const [preview, setPreview] = useState<PostImagePreview | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fullPrompt, setFullPrompt] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!template) {
      setPreview(null);
      setValues({});
      setFullPrompt("");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.previewPostImage(cardId, post.id, {
        template_id: template.id,
      });
      setPreview(result);
      setValues(result.extracted);
      setFullPrompt(result.resolved);
    } catch (err) {
      setError((err as Error).message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [template, cardId, post.id]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  // Keep the full-prompt view in sync when the user edits a variable
  // value — only when we are on the "vars" tab so we don't stomp manual
  // edits made in the full-prompt textarea.
  useEffect(() => {
    if (tab !== "vars" || !template) return;
    setFullPrompt(substitute(template.content, values));
  }, [values, template, tab]);

  // ESC to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = async () => {
    setGenerating(true);
    setError(null);
    try {
      const pending = await api.generatePostImage(cardId, post.id, {
        resolved_prompt: fullPrompt,
      });
      onJobStarted(
        pending,
        t("toasts.imageGenerating", {
          defaultValue: "Generating image — feel free to keep working…",
        }) ?? "Generating image…",
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex flex-col sm:items-start sm:justify-center sm:px-4 sm:pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("posts.pregen.title", { defaultValue: "Image prompt preview" }) ?? ""}
    >
      <button
        type="button"
        aria-label={t("common.close") ?? "Close"}
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-md"
      />
      <div className="relative flex h-full w-full flex-col overflow-hidden border-0 bg-ink-800 sm:h-[88vh] sm:max-h-[860px] sm:min-h-[600px] sm:w-full sm:max-w-3xl sm:rounded-2xl sm:border sm:border-ink-700 sm:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink-100">
            <ImageIcon className="h-4 w-4 text-ink-400" />
            {t("posts.pregen.title", { defaultValue: "Image prompt preview" })}
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

        {/* Template picker */}
        <div className="flex items-center gap-2 border-b border-ink-700/60 px-5 py-2.5 text-xs">
          <label className="text-ink-300">
            {t("posts.pregen.template", { defaultValue: "Template" })}
          </label>
          <select
            value={templateId ?? ""}
            onChange={(e) => setTemplateId(e.target.value || null)}
            className="flex-1 rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1 text-ink-100 focus:border-ink-500 focus:outline-none"
          >
            <option value="">
              {t("posts.pregen.noTemplate", { defaultValue: "— No template —" })}
            </option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
                {tpl.is_default ? " ★" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void fetchPreview()}
            disabled={previewing || !template}
            className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-ink-300 transition hover:bg-ink-700 disabled:opacity-50"
            title={t("posts.pregen.refetch", { defaultValue: "Re-extract values" }) ?? ""}
          >
            <RefreshCw className={["h-3 w-3", previewing ? "animate-spin" : ""].join(" ")} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-ink-700/60 px-5">
          {[
            { key: "vars" as const, label: t("posts.pregen.tabVars", { defaultValue: "Variables" }) },
            { key: "full" as const, label: t("posts.pregen.tabFull", { defaultValue: "Full prompt" }) },
          ].map((tab_) => {
            const active = tab === tab_.key;
            return (
              <button
                key={tab_.key}
                type="button"
                onClick={() => setTab(tab_.key)}
                className={[
                  "border-b-2 px-3 py-2 text-xs font-medium transition",
                  active
                    ? "border-ink-100 text-ink-100"
                    : "border-transparent text-ink-400 hover:text-ink-200",
                ].join(" ")}
              >
                {tab_.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!template ? (
            <p className="text-sm text-ink-400">
              {t("posts.pregen.noTemplateHint", {
                defaultValue:
                  "Pick a template above to preview the prompt — or create one in Settings → Image templates.",
              })}
            </p>
          ) : previewing ? (
            <div className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("posts.pregen.extracting", {
                defaultValue: "Extracting variable values from the post…",
              })}
            </div>
          ) : tab === "vars" ? (
            <div className="space-y-2.5">
              {preview && preview.detected.length === 0 && (
                <p className="text-sm text-ink-400">
                  {t("posts.pregen.noVars", {
                    defaultValue:
                      "This template has no variables — the full prompt tab shows what will be sent.",
                  })}
                </p>
              )}
              {preview?.detected.map((varName) => {
                const isUnknown = preview.unknown.includes(varName);
                return (
                  <div key={varName}>
                    <label className="flex items-center justify-between text-[11px] font-medium text-ink-300">
                      <span className="font-mono">{`{{${varName}}}`}</span>
                      {isUnknown && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                          {t("posts.pregen.unknownVar", { defaultValue: "Unknown" })}
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={values[varName] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [varName]: e.target.value }))
                      }
                      placeholder={t("posts.pregen.placeholder", {
                        defaultValue: "(empty)",
                      }) ?? ""}
                      className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <textarea
              value={fullPrompt}
              onChange={(e) => setFullPrompt(e.target.value)}
              rows={20}
              className="block h-full w-full resize-none rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-100 focus:border-ink-500 focus:outline-none"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-ink-700 px-5 py-3">
          <span className="text-[11px] text-ink-500">
            {error
              ? error
              : t("posts.pregen.footerHint", {
                  defaultValue:
                    "Tweak any value or the full prompt, then generate — costs one gpt-image-2 call.",
                })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={generating || !fullPrompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {t("posts.pregen.generate", { defaultValue: "Generate image" })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
