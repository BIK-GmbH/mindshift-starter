import { CheckCircle2, Compass, Globe, Loader2, Lock, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import MobileDesktopHint from "../components/MobileDesktopHint";
import { api, type PathListItem } from "../lib/api";

/**
 * Lists every path the user owns. Click → editor. Create button → new
 * path with a placeholder title; user can rename it inline in the
 * editor. Public paths get a small globe pill so you can see at a
 * glance which ones are shared.
 */
export default function PathsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [paths, setPaths] = useState<PathListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPaths = useCallback(async () => {
    try {
      const list = await api.listPaths();
      setPaths(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPaths();
  }, [fetchPaths]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const detail = await api.createPath(
        t("paths.untitled", { defaultValue: "Untitled path" }) ?? "Untitled path",
      );
      navigate(`/paths/${detail.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MobileDesktopHint reasonKey="mobileHint.paths" />
      <div className="page-header">
        <div className="page-header-inner flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30">
              <Compass className="h-4 w-4 text-fuchsia-300" />
            </div>
            <div className="min-w-0">
              <h1 className="page-header-title">{t("paths.title", { defaultValue: "Paths" })}</h1>
              <p className="page-header-subtitle">
                {t("paths.subtitle", {
                  defaultValue: "Curate ordered learning paths from your cards. Share them publicly under your profile.",
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t("paths.new", { defaultValue: "New path" })}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-6">
          {error && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </div>
          ) : paths.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-6 py-12 text-center">
              <Compass className="mx-auto mb-3 h-8 w-8 text-ink-600" />
              <p className="mb-2 text-sm text-ink-200">
                {t("paths.empty.title", { defaultValue: "No paths yet" })}
              </p>
              <p className="text-xs text-ink-400">
                {t("paths.empty.body", {
                  defaultValue: "Create your first path to bundle a series of cards into a course.",
                })}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {paths.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/paths/${p.id}`)}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/30 text-left transition hover:border-fuchsia-500/40 hover:bg-ink-800/50"
                  >
                    <div className="aspect-[16/8] w-full bg-gradient-to-br from-fuchsia-500/20 via-ink-800/40 to-ink-900/40">
                      {p.cover_url && (
                        // eslint-disable-next-line jsx-a11y/img-redundant-alt
                        <img src={p.cover_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                            p.is_public
                              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                              : "bg-ink-800 text-ink-500 ring-1 ring-ink-700",
                          ].join(" ")}
                        >
                          {p.is_public ? <Globe className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                          {p.is_public
                            ? t("paths.publicPill", { defaultValue: "Public" })
                            : t("paths.privatePill", { defaultValue: "Private" })}
                        </span>
                      </div>
                      <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-ink-100 group-hover:text-fuchsia-300">
                        {p.title}
                      </h3>
                      <div className="mt-auto flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-ink-500">
                        <span>
                          {p.card_count}{" "}
                          {p.card_count === 1
                            ? t("paths.cardSingular", { defaultValue: "card" })
                            : t("paths.cardPlural", { defaultValue: "cards" })}
                        </span>
                        {/* Progress pill — only shows when the user has
                            interacted with this path. Three states:
                            completed (green check), in progress (% bar),
                            no progress (nothing). */}
                        {p.progress_completed_at ? (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            {t("paths.completed", { defaultValue: "Completed" })}
                          </span>
                        ) : p.progress_position !== null && p.card_count > 0 ? (
                          <span className="text-fuchsia-300">
                            {Math.round(((p.progress_position + 1) / p.card_count) * 100)}%
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
