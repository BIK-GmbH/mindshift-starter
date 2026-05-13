import { Brain, Check, Compass, FileText, Github, Globe, Loader2, Play, RotateCw, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import RailFooterButtons from "../components/RailFooterButtons";
import { api, type PublicPathOut } from "../lib/api";
import { setMetaTags } from "../lib/metaTags";
import { clearCompleted, loadCompleted, saveCompleted } from "../lib/publicPathProgress";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  note: FileText,
  github: Github,
};

/**
 * Read-only public view of a learning path. Mirrors the look of the
 * other public pages (Profile, Tag, Card) — top brand band, hero with
 * cover + title + author, optional description, then the ordered card
 * list. Each card links to its own public page (`/share/<token>` is
 * not used here yet — we follow the path under the same author URL).
 */
export default function PublicPathPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { username = "", slug = "" } = useParams<{ username: string; slug: string }>();
  const [path, setPath] = useState<PublicPathOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anonymous client-side progress — checked steps live in localStorage
  // so visitors who aren't logged in can still mark progress on a path
  // they're working through. Survives refresh, doesn't sync across
  // devices (this is intentional — the moment you want sync you log in).
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  useEffect(() => {
    setCompleted(loadCompleted(username, slug));
  }, [username, slug]);

  const toggleStep = (i: number) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      saveCompleted(username, slug, next);
      return next;
    });
  };

  const reset = () => {
    clearCompleted(username, slug);
    setCompleted(new Set());
  };

  const progressPct = useMemo(() => {
    if (!path || path.cards.length === 0) return 0;
    return Math.round((completed.size / path.cards.length) * 100);
  }, [completed, path]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.publicPath(username, slug);
        setPath(data);
        setMetaTags({
          title: `${data.title} — ${data.author_username}`,
          description:
            data.description_md?.slice(0, 160) ??
            `A learning path with ${data.cards.length} cards by @${data.author_username}.`,
          image: data.cover_url ?? null,
        });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [username, slug]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (!path) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      {/* Brand band */}
      <header className="border-b border-ink-800 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-ink-100" />
            <span className="text-sm font-semibold text-ink-100">Mindshift</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to={`/u/${path.author_username}`}
              className="truncate text-[11px] text-ink-400 hover:text-ink-100"
            >
              @{path.author_username}
            </Link>
            <RailFooterButtons orientation="row" showSettings={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 page-enter">
        {/* Hero */}
        <div className="mb-8">
          {path.cover_url && (
            <img
              src={path.cover_url}
              alt=""
              className="mb-4 aspect-[16/8] w-full rounded-xl object-cover"
            />
          )}
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-fuchsia-300">
            <Compass className="h-3.5 w-3.5" />
            {t("paths.title", { defaultValue: "Path" })} · {path.cards.length}{" "}
            {path.cards.length === 1
              ? t("paths.cardSingular", { defaultValue: "card" })
              : t("paths.cardPlural", { defaultValue: "cards" })}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-ink-100">{path.title}</h1>
          {path.description_md && (
            <div className="prose prose-invert prose-sm mt-3 max-w-none text-ink-300">
              <MarkdownView source={path.description_md} />
            </div>
          )}
          {/* Anonymous progress bar + reset. Only shows once the visitor
              has marked at least one step. */}
          {completed.size > 0 && (
            <div className="mt-4 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-300">
                <span>
                  <span className="font-semibold text-fuchsia-200">{completed.size}</span> /{" "}
                  {path.cards.length} {t("paths.completedSteps", { defaultValue: "steps done" })}
                  {" · "}
                  <span className="text-ink-500">{progressPct}%</span>
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-400 transition hover:text-ink-100"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                  {t("paths.resetProgress", { defaultValue: "Reset" })}
                </button>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-300 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
          {path && path.cards.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => navigate(`/u/${username}/path/${slug}/play`)}
                className="inline-flex items-center gap-2 rounded-md bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 ring-1 ring-fuchsia-500/40 transition hover:bg-fuchsia-500/30"
              >
                <Play className="h-4 w-4" />
                {t("paths.startPath", { defaultValue: "Start path" })}
              </button>
            </div>
          )}
        </div>

        {/* Steps */}
        <ol className="cards-stagger space-y-3">
          {path.cards.map((c, i) => {
            const Icon = SOURCE_ICONS[c.source_type] ?? FileText;
            const isDone = completed.has(i);
            return (
              <li
                key={c.card_id}
                className={[
                  "rounded-xl border p-4 transition",
                  isDone
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-ink-800 bg-ink-800/30",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleStep(i)}
                    aria-label={
                      isDone
                        ? t("paths.markIncomplete", { defaultValue: "Mark as incomplete" }) ?? ""
                        : t("paths.markComplete", { defaultValue: "Mark as complete" }) ?? ""
                    }
                    className={[
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition",
                      isDone
                        ? "border-emerald-400 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25"
                        : "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:border-fuchsia-500/60",
                    ].join(" ")}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-500">
                      <Icon className="h-3 w-3" />
                      {c.source_type}
                    </div>
                    <h2 className="text-sm font-semibold text-ink-100">{c.title}</h2>
                    {c.lesson_md && (
                      <div className="mt-2 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2">
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-fuchsia-300">
                          {t("paths.lesson", { defaultValue: "Lesson" })}
                        </p>
                        <div className="prose prose-invert prose-sm max-w-none text-ink-200">
                          <MarkdownView source={c.lesson_md} />
                        </div>
                      </div>
                    )}
                    {c.concise_summary_md && (
                      <p className="mt-2 line-clamp-3 text-xs text-ink-400">
                        {c.concise_summary_md}
                      </p>
                    )}
                  </div>
                  {c.thumbnail_url && (
                    <img
                      src={c.thumbnail_url}
                      alt=""
                      className="h-14 w-20 flex-shrink-0 rounded object-cover"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}
