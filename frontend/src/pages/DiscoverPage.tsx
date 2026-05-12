/* Discover — library-style list of YouTube suggestions, grouped by
 * theme (= the user's top-level tags). Mirrors LibraryPage's layout:
 *
 *   ┌─────────────┬──────────────────────────────────────────┐
 *   │ Themes side │   sticky toolbar                         │
 *   │ (like tags) │   ─────────────────────────────────────  │
 *   │             │   list of <DiscoverVideoRow>             │
 *   │  AI Agents  │                                          │
 *   │  Open Src   │   [ Mehr laden ]                         │
 *   │  Finance    │                                          │
 *   │  …          │                                          │
 *   └─────────────┴──────────────────────────────────────────┘
 *
 * Themes are the user's top-level tags; suggestions are cached
 * server-side for 24 h (up to 24 per theme) and paged client-side
 * with "Mehr laden". Clicking a row's play button switches the
 * thumbnail for an embedded iframe so the user can pre-screen
 * before deciding whether to save the video to Mindshift.
 */

import { Loader2, RefreshCw, Sparkles, Youtube } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import DiscoverVideoRow from "../components/DiscoverVideoRow";
import { api, type YouTubeDiscover, type YouTubeDiscoverTheme } from "../lib/api";

const PAGE_SIZE = 8;

export default function DiscoverPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<YouTubeDiscover | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  // Per-theme reveal cursor — initial PAGE_SIZE per theme.
  const [visible, setVisible] = useState<Record<string, number>>({});
  // Which row is currently playing — only one at a time.
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setPlayingId(null);
    try {
      const res = await api.getYouTubeDiscover(refresh);
      setData(res);
      setVisible(Object.fromEntries(res.themes.map((th) => [th.slug, PAGE_SIZE])));
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

  const handleSaved = (slug: string, videoId: string, savedCardId: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            themes: prev.themes.map((th) =>
              th.slug === slug
                ? {
                    ...th,
                    results: th.results.map((r) =>
                      r.video_id === videoId
                        ? { ...r, already_saved_card_id: savedCardId }
                        : r,
                    ),
                  }
                : th,
            ),
          }
        : prev,
    );
  };

  const togglePlay = (videoId: string) => {
    setPlayingId((prev) => (prev === videoId ? null : videoId));
  };

  return (
    <div className="flex h-full">
      {/* Theme sidebar — desktop only, mirrors LibraryTagsSidebar. */}
      <aside className="panel-elevated relative hidden w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 md:flex">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
            <Sparkles className="h-3 w-3" />
            {t("discover.themes", { defaultValue: "Themen" })}
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <ThemeNavButton
            label={t("discover.allThemes", { defaultValue: "Alle Themen" })}
            count={totalCards}
            active={activeSlug === null}
            onClick={() => setActiveSlug(null)}
          />
          {data?.themes.map((th) => (
            <ThemeNavButton
              key={th.slug}
              label={th.label}
              count={th.card_count}
              active={activeSlug === th.slug}
              onClick={() => setActiveSlug(th.slug)}
            />
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky header band — matches CardDetailPage's layout pattern.
         *  Mobile tweaks: tighter padding, smaller title, refresh button
         *  collapses to icon-only to free up width. */}
        <div className="flex-shrink-0 border-b border-ink-800 bg-ink-950/70 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 px-4 py-3 md:px-6 md:py-4 lg:px-8">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ink-500">
                <Sparkles className="h-3 w-3" />
                {t("discover.kicker", { defaultValue: "Discover" })}
              </p>
              <h1 className="mt-1 truncate text-lg font-semibold text-ink-100 md:text-xl">
                {t("discover.title", { defaultValue: "Für dich auf YouTube" })}
              </h1>
              {data && data.api_enabled && (
                <p className="mt-0.5 truncate text-[11px] text-ink-400">
                  {t("discover.lead", {
                    count: totalCards,
                    defaultValue:
                      "{{count}} Karten in deiner Library haben das Themen-Set gespeist.",
                  })}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 hover:text-ink-100 disabled:opacity-50"
              aria-label={t("discover.refresh", { defaultValue: "Neu generieren" }) ?? ""}
            >
              <RefreshCw
                className={["h-3 w-3", refreshing ? "animate-spin" : ""].join(" ")}
              />
              <span className="hidden sm:inline">
                {t("discover.refresh", { defaultValue: "Neu generieren" })}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile-only theme chips — horizontal scroll under the
         *  header. The desktop sidebar covers the same affordance, so
         *  we hide this from `md` upward. */}
        {data && data.api_enabled && data.themes.length > 0 && (
          <div
            className="mx-auto flex w-full max-w-6xl flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-ink-800 bg-ink-950/40 px-3 py-2 md:hidden"
            aria-label={t("discover.themes", { defaultValue: "Themen" }) ?? ""}
          >
            <ThemeChip
              label={t("discover.allThemes", { defaultValue: "Alle Themen" })}
              count={totalCards}
              active={activeSlug === null}
              onClick={() => setActiveSlug(null)}
            />
            {data.themes.map((th) => (
              <ThemeChip
                key={th.slug}
                label={th.label}
                count={th.card_count}
                active={activeSlug === th.slug}
                onClick={() => setActiveSlug(th.slug)}
              />
            ))}
          </div>
        )}

        {/* Content — centered with the same max-width as LibraryPage
         *  so wide monitors don't stretch the rows edge to edge.
         *  Extra bottom padding on mobile to clear the fixed
         *  MobileBottomNav (~56 px + iOS safe-area). */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
         <div className="mx-auto max-w-6xl px-3 sm:px-6 lg:px-8">
          {loading && (
            <div className="flex items-center gap-2 py-12 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("discover.loading", { defaultValue: "Lade Vorschläge…" })}
            </div>
          )}

          {!loading && error && (
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
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
            <div className="divide-y divide-ink-800">
              {visibleThemes.map((th) => (
                <ThemeSection
                  key={th.slug}
                  theme={th}
                  visible={visible[th.slug] ?? PAGE_SIZE}
                  onLoadMore={() =>
                    setVisible((prev) => ({
                      ...prev,
                      [th.slug]: Math.min(
                        (prev[th.slug] ?? PAGE_SIZE) + PAGE_SIZE,
                        th.results.length,
                      ),
                    }))
                  }
                  playingId={playingId}
                  onTogglePlay={togglePlay}
                  onSaved={(vid, cid) => handleSaved(th.slug, vid, cid)}
                />
              ))}
            </div>
          )}
         </div>
        </div>
      </div>
    </div>
  );
}

function ThemeSection({
  theme,
  visible,
  onLoadMore,
  playingId,
  onTogglePlay,
  onSaved,
}: {
  theme: YouTubeDiscoverTheme;
  visible: number;
  onLoadMore: () => void;
  playingId: string | null;
  onTogglePlay: (videoId: string) => void;
  onSaved: (videoId: string, cardId: string) => void;
}) {
  const { t } = useTranslation();
  const items = theme.results.slice(0, visible);
  const hasMore = visible < theme.results.length;

  return (
    <section className="px-2 py-4 md:px-4">
      <header className="flex items-baseline justify-between gap-3 px-2 pb-2 md:px-2">
        <h2 className="text-sm font-semibold text-ink-100">
          {theme.label}{" "}
          <span className="font-normal text-[11px] text-ink-500">
            ·{" "}
            {t("discover.cardCount", {
              count: theme.card_count,
              defaultValue: "{{count}} deiner Karten",
            })}
          </span>
        </h2>
        {theme.queries && theme.queries.length > 0 && (
          <p className="hidden truncate text-[10px] text-ink-600 md:block">
            {t("discover.queriesPrefix", { defaultValue: "Queries:" })}{" "}
            <span className="text-violet-300">{theme.queries.join(" · ")}</span>
          </p>
        )}
      </header>

      {items.length === 0 ? (
        <p className="mx-2 rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-4 py-6 text-center text-xs text-ink-500">
          {t("discover.themeEmpty", {
            defaultValue: "Keine Treffer für dieses Thema.",
          })}
        </p>
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40">
            {items.map((r) => (
              <DiscoverVideoRow
                key={r.video_id}
                item={r}
                playing={playingId === r.video_id}
                onTogglePlay={() => onTogglePlay(r.video_id)}
                onSaved={(savedCardId, videoId) => onSaved(videoId, savedCardId)}
              />
            ))}
          </ul>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-[11px] text-ink-200 transition hover:bg-ink-800 hover:text-ink-100"
              >
                {t("discover.loadMore", { defaultValue: "Mehr laden" })}
                <span className="text-ink-500">
                  ({theme.results.length - visible})
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ThemeChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition",
        active
          ? "bg-violet-500 text-white"
          : "border border-ink-700 text-ink-300 hover:text-ink-100",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span
        className={[
          "rounded px-1 text-[9px]",
          active ? "bg-white/20" : "text-ink-500",
        ].join(" ")}
      >
        {count}
      </span>
    </button>
  );
}

function ThemeNavButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs transition",
        active
          ? "bg-ink-800/70 text-ink-100"
          : "text-ink-300 hover:bg-ink-800/40 hover:text-ink-100",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span className="text-[10px] text-ink-500">{count}</span>
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
    <div className="m-6 flex flex-col items-start gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-6 py-10 text-sm text-ink-400">
      {icon}
      <p className="font-medium text-ink-200">{title}</p>
      <p className="text-xs text-ink-500">{body}</p>
    </div>
  );
}
