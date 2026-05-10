import { CheckCircle2, Compass, Globe, Loader2, Lock, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import PageHeader from "../components/PageHeader";
import { api, type PathListItem } from "../lib/api";
import { useAuthedImage } from "../lib/useAuthedImage";

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
      <PageHeader
        icon={Compass}
        tone="fuchsia"
        title={t("paths.title", { defaultValue: "Paths" })}
        subtitle={t("paths.subtitle", {
          defaultValue:
            "Curate ordered learning paths from your cards. Share them publicly under your profile.",
        })}
        action={
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            aria-label={t("paths.new", { defaultValue: "New path" }) ?? "New path"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-900 transition hover:bg-ink-200 disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-1.5 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-xs sm:font-semibold"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">
              {t("paths.new", { defaultValue: "New path" })}
            </span>
          </button>
        }
      />

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
                  <PathTile path={p} onOpen={() => navigate(`/paths/${p.id}`)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Tile — extracted so it can call the auth-image hook per path.
 * -------------------------------------------------------------------- */

function PathTile({ path: p, onOpen }: { path: PathListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const { src: coverSrc } = useAuthedImage(p.cover_url);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/30 text-left transition hover:border-fuchsia-500/40 hover:bg-ink-800/50"
    >
      <div className="aspect-[16/8] w-full bg-gradient-to-br from-fuchsia-500/20 via-ink-800/40 to-ink-900/40">
        {coverSrc && (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img src={coverSrc} alt="" className="h-full w-full object-cover" />
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
  );
}
