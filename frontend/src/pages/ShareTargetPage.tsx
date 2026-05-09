import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../lib/api";

/**
 * Web-share-target landing route. Triggered when the OS share sheet
 * routes a URL into the installed PWA. We pull a URL out of the
 * incoming params (some apps use `url`, some bury it inside `text`),
 * call the unified /from-url endpoint (which already auto-detects
 * YouTube and GitHub), then forward the user to the resulting card.
 */
export default function ShareTargetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"creating" | "error">("creating");
  const [error, setError] = useState<string | null>(null);
  // Strict-mode double-mount guard — without this we'd POST twice in dev.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const url = extractUrl({
      url: params.get("url"),
      text: params.get("text"),
      title: params.get("title"),
    });
    if (!url) {
      setError(
        t("shareTarget.noUrl", {
          defaultValue: "No URL detected in the share. Open Mindshift and paste it manually.",
        }) ?? "",
      );
      setPhase("error");
      return;
    }

    void (async () => {
      try {
        const result = await api.createFromUrl(url);
        navigate(`/cards/${result.card.id}`, { replace: true });
      } catch (err) {
        setError((err as Error).message);
        setPhase("error");
      }
    })();
  }, [params, navigate, t]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="surface-soft w-full max-w-sm rounded-xl border border-ink-800 bg-ink-800/40 p-6 text-center">
        {phase === "creating" ? (
          <>
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-ink-300" />
            <h2 className="text-sm font-semibold text-ink-100">
              {t("shareTarget.saving", { defaultValue: "Saving to Mindshift…" })}
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              {t("shareTarget.savingHint", {
                defaultValue: "We're queuing the page for ingestion. You'll be redirected in a second.",
              })}
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto mb-3 h-6 w-6 text-red-400" />
            <h2 className="text-sm font-semibold text-ink-100">
              {t("shareTarget.failed", { defaultValue: "Couldn't save" })}
            </h2>
            <p className="mt-1 text-xs text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-800"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("common.back", { defaultValue: "Back to library" })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * iOS Safari and several Android apps stuff the URL into `text` instead
 * of `url`, sometimes mixed with the page title. We try `url` first,
 * fall back to scanning `text` and `title` for the first http(s) URL.
 */
function extractUrl(parts: { url: string | null; text: string | null; title: string | null }): string | null {
  if (parts.url && /^https?:\/\//i.test(parts.url)) return parts.url.trim();
  const haystack = [parts.text, parts.title, parts.url].filter(Boolean).join(" ");
  const match = haystack.match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[)\].,;:!?]+$/, "") : null;
}
