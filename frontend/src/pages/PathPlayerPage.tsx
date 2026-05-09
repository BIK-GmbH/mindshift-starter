import { ArrowLeft, ArrowRight, ChevronLeft, Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import CardDetailContent from "../components/CardDetailContent";
import MarkdownView from "../components/MarkdownView";
import MobileDesktopHint from "../components/MobileDesktopHint";
import { api, type PathDetail } from "../lib/api";

/**
 * Linear path player. Sticky top bar carries the path title, a
 * step indicator, prev / next, and an "edit" link back to the editor.
 * The card itself is rendered by the existing CardDetailContent
 * component — every tab the user knows from the library works here too.
 *
 * Position is held in the URL `?step=` so the back button, refresh and
 * deep-links all behave correctly.
 */
export default function PathPlayerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathId = "" } = useParams<{ pathId: string }>();
  const [params, setParams] = useSearchParams();
  const [path, setPath] = useState<PathDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPath = useCallback(async () => {
    try {
      const detail = await api.getPath(pathId);
      setPath(detail);
      // If the user has prior progress and the URL doesn't already
      // override the step, jump them to where they left off.
      if (!params.get("step")) {
        try {
          const prog = await api.getPathProgress(pathId);
          if (prog && prog.current_position > 0) {
            const next = new URLSearchParams(params);
            next.set("step", String(prog.current_position + 1));
            setParams(next, { replace: true });
          }
        } catch {
          /* ignore — progress is best-effort */
        }
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId]);

  useEffect(() => {
    void fetchPath();
  }, [fetchPath]);

  const stepRaw = parseInt(params.get("step") ?? "1", 10);
  const total = path?.cards.length ?? 0;
  const step = Number.isFinite(stepRaw) ? Math.min(Math.max(1, stepRaw), Math.max(1, total)) : 1;
  const current = path?.cards[step - 1] ?? null;

  // Persist progress whenever the active step changes. Server takes the
  // max so revisiting earlier steps doesn't roll the bookmark back.
  useEffect(() => {
    if (!path || total === 0) return;
    void api.updatePathProgress(pathId, step - 1).catch(() => {
      /* progress is best-effort; don't block the player on failure */
    });
  }, [pathId, step, total, path]);

  const goTo = (s: number) => {
    const next = new URLSearchParams(params);
    next.set("step", String(Math.min(Math.max(1, s), total)));
    setParams(next, { replace: true });
  };

  // Keyboard navigation — left/right arrow keys move through steps.
  // Skip when the user is typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.key === "ArrowRight" && step < total) goTo(step + 1);
      if (e.key === "ArrowLeft" && step > 1) goTo(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, total]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {error ?? t("paths.notFound", { defaultValue: "Path not found" })}
      </div>
    );
  }
  if (path.cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-400">
        <div>
          <p className="mb-3">{t("paths.noStepsToPlay", { defaultValue: "This path has no steps yet." })}</p>
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}`)}
            className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <Pencil className="h-3 w-3" />
            {t("paths.openEditor", { defaultValue: "Open editor" })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MobileDesktopHint reasonKey="mobileHint.paths" />
      {/* Player bar — replaces the standard page-header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}`)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            title={t("paths.openEditor", { defaultValue: "Open editor" }) ?? ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-300">
              {t("paths.title", { defaultValue: "Path" })}
            </p>
            <h1 className="truncate text-sm font-semibold text-ink-100">{path.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-ink-800/60 px-2 py-1 font-mono text-[10px] tabular-nums text-ink-300">
              {step} / {total}
            </span>
            <button
              type="button"
              disabled={step <= 1}
              onClick={() => goTo(step - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
              title={t("paths.prev", { defaultValue: "Previous step" }) ?? ""}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={step >= total}
              onClick={() => goTo(step + 1)}
              className="flex h-9 items-center gap-1 rounded-md bg-fuchsia-500/15 px-3 text-xs font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition hover:bg-fuchsia-500/25 disabled:opacity-30"
            >
              {t("paths.next", { defaultValue: "Next" })}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 w-full bg-ink-800">
          <div
            className="h-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-300 transition-all"
            style={{ width: `${(step / total) * 100}%` }}
          />
        </div>
      </div>

      {current?.lesson_md && (
        <div className="flex-shrink-0 border-b border-ink-800 bg-fuchsia-500/5">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fuchsia-300">
              {t("paths.lesson", { defaultValue: "Lesson" })}
            </p>
            <div className="prose prose-invert prose-sm max-w-none text-ink-200">
              <MarkdownView source={current.lesson_md} />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {current && (
          <CardDetailContent
            key={current.card_id}
            cardId={current.card_id}
            onBack={() => navigate(`/paths/${pathId}`)}
            backStyle="close"
          />
        )}
      </div>
    </div>
  );
}
