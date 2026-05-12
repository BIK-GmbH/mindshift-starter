/* Global YouTube-Discover surface.
 *
 * Reads `/api/youtube/discover` once per visit (server-side cached for
 * 24 h per (user, theme)). Themes come from the user's top-level tags
 * ordered by card count; each theme runs one YouTube `search.list`.
 *
 * Layout mirrors the mockup: sticky header with title + actions, a
 * horizontal chip strip to filter by theme, then per-theme grids.
 */

import { Loader2, RefreshCw, Sparkles, Youtube } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import YouTubeSuggestCard from "../components/YouTubeSuggestCard";
import { api, type YouTubeDiscover } from "../lib/api";

export default function DiscoverPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<YouTubeDiscover | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const load = async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.getYouTubeDiscover(refresh);
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const visibleThemes = useMemo(() => {
    if (!data) return [];
    if (!activeSlug) return data.themes;
    return data.themes.filter((th) => th.slug === activeSlug);
  }, [data, activeSlug]);

  const totalCards = useMemo(
    () => (data ? data.themes.reduce((sum, th) => sum + th.card_count, 0) : 0),
    [data],
  );

  return (
    <div className="flex h-full flex-col">
      {/* sticky header band */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-950/70 backdrop-blur px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ink-500">
              <Sparkles className="h-3 w-3" />
              {t("discover.kicker", { defaultValue: "Discover" })}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-100">
              {t("discover.title", { defaultValue: "Für dich auf YouTube" })}
            </h1>
            {data && data.api_enabled && (
              <p className="mt-1 text-[11px] text-ink-400">
                {t("discover.lead", {
                  count: totalCards,
                  defaultValue:
                    "{{count}} Karten in deiner Library haben das Themen-Set gespeist.",
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1 text-ink-300 hover:text-ink-100 disabled:opacity-50"
            >
              <RefreshCw
                className={["h-3 w-3", refreshing ? "animate-spin" : ""].join(" ")}
              />
              {t("discover.refresh", { defaultValue: "Neu generieren" })}
            </button>
          </div>
        </div>

        {data && data.themes.length > 0 && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            <ThemeChip
              label={t("discover.allThemes", { defaultValue: "Alle Themen" })}
              active={activeSlug === null}
              onClick={() => setActiveSlug(null)}
            />
            {data.themes.map((th) => (
              <ThemeChip
                key={th.slug}
                label={th.label}
                active={activeSlug === th.slug}
                onClick={() => setActiveSlug(th.slug)}
              />
            ))}
          </div>
        )}
      </div>

      {/* content scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center gap-2 py-12 text-sm text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("discover.loading", { defaultValue: "Lade Vorschläge…" })}
          </div>
        )}

        {!loading && error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {!loading && data && !data.api_enabled && (
          <EmptyState
            icon={<Youtube className="h-6 w-6 text-ink-500" />}
            title={t("discover.disabledTitle", {
              defaultValue: "YouTube-Vorschläge sind aus",
            })}
            body={t("discover.disabledBody", {
              defaultValue:
                "Setze YOUTUBE_API_KEY in der .env, um Themen-basiert YouTube-Videos vorgeschlagen zu bekommen.",
            })}
          />
        )}

        {!loading && data && data.api_enabled && data.themes.length === 0 && (
          <EmptyState
            icon={<Sparkles className="h-6 w-6 text-ink-500" />}
            title={t("discover.emptyTitle", {
              defaultValue: "Noch keine Themen erkannt",
            })}
            body={t("discover.emptyBody", {
              defaultValue:
                "Vergib Top-Level-Tags an ein paar Karten — Discover gruppiert deine Library nach diesen Tags.",
            })}
          />
        )}

        {!loading && data && data.api_enabled && visibleThemes.length > 0 && (
          <div className="space-y-8">
            {visibleThemes.map((th) => (
              <section key={th.slug}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink-100">
                    {th.label}{" "}
                    <span className="font-normal text-[11px] text-ink-500">
                      ·{" "}
                      {t("discover.cardCount", {
                        count: th.card_count,
                        defaultValue: "{{count}} deiner Karten",
                      })}
                    </span>
                  </h2>
                  <span className="text-[10px] text-ink-600">
                    {t("discover.query", { defaultValue: "Query" })}:{" "}
                    <span className="text-violet-300">{th.query}</span>
                  </span>
                </div>
                {th.results.length === 0 ? (
                  <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-4 py-6 text-center text-xs text-ink-500">
                    {t("discover.themeEmpty", {
                      defaultValue: "Keine Treffer für dieses Thema.",
                    })}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {th.results.map((r) => (
                      <YouTubeSuggestCard
                        key={r.video_id}
                        item={r}
                        onSaved={(savedCardId, videoId) =>
                          setData((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  themes: prev.themes.map((it) =>
                                    it.slug === th.slug
                                      ? {
                                          ...it,
                                          results: it.results.map((rr) =>
                                            rr.video_id === videoId
                                              ? {
                                                  ...rr,
                                                  already_saved_card_id: savedCardId,
                                                }
                                              : rr,
                                          ),
                                        }
                                      : it,
                                  ),
                                }
                              : prev,
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThemeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition",
        active
          ? "bg-violet-500 text-white"
          : "border border-ink-700 text-ink-300 hover:text-ink-100",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-6 py-10 text-sm text-ink-400">
      {icon}
      <p className="font-medium text-ink-200">{title}</p>
      <p className="text-xs text-ink-500">{body}</p>
    </div>
  );
}
