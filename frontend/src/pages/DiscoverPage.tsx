/* Discover — library-style list of YouTube suggestions.
 *
 * Layout:
 *   ┌────────────┬────────────────────────────────────────────┐
 *   │ Theme side │  PageHeader (title + action)               │
 *   │ (desktop)  │  Toolbar: [search] [freshness] [refresh]   │
 *   │            │  Recent search chips                       │
 *   │  ai 133    │  ── content ─────────────────────────────  │
 *   │  open-src  │  Search results (when active)              │
 *   │  ml 45     │  Themes                                    │
 *   │  …         │  [ Load more ]                             │
 *   └────────────┴────────────────────────────────────────────┘
 *
 * Three data flows:
 *  - auto themes:  /api/youtube/discover, LLM-built queries
 *  - custom search: /api/youtube/search, raw user query
 *  - recent: localStorage list of the user's last 12 queries
 *
 * The custom search section renders ABOVE the themes when active,
 * giving the user the "I asked, here's the answer" feedback loop
 * without losing context of the auto suggestions below.
 */

import {
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import DiscoverVideoRow from "../components/DiscoverVideoRow";
import PageHeader from "../components/PageHeader";
import VoiceRecordButton from "../components/VoiceRecordButton";
import {
  api,
  type YouTubeCustomSearch,
  type YouTubeDiscover,
  type YouTubeDiscoverTheme,
  type YouTubeFreshness,
  type YouTubeSuggestion,
} from "../lib/api";

const PAGE_SIZE = 8;
const FRESHNESS_STORAGE_KEY = "mindshift.discover.freshness";
const RECENT_SEARCHES_KEY = "mindshift.discover.recentSearches";
const RECENT_MAX = 12;

const FRESHNESS_OPTIONS: { value: YouTubeFreshness; labelKey: string; fallback: string }[] = [
  { value: "week", labelKey: "discover.freshness.week", fallback: "Woche" },
  { value: "month", labelKey: "discover.freshness.month", fallback: "Monat" },
  { value: "quarter", labelKey: "discover.freshness.quarter", fallback: "Quartal" },
  { value: "year", labelKey: "discover.freshness.year", fallback: "Jahr" },
  { value: "all", labelKey: "discover.freshness.all", fallback: "Alle" },
];

function readPersistedFreshness(): YouTubeFreshness {
  try {
    const v = localStorage.getItem(FRESHNESS_STORAGE_KEY);
    if (v && FRESHNESS_OPTIONS.some((o) => o.value === v)) {
      return v as YouTubeFreshness;
    }
  } catch {
    // ignore
  }
  return "month";
}

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function persistRecentSearches(list: string[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<YouTubeDiscover | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, number>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<YouTubeFreshness>(() => readPersistedFreshness());

  // Custom-search state.
  const [searchInput, setSearchInput] = useState("");
  const [searchActive, setSearchActive] = useState<YouTubeCustomSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const load = async (refresh: boolean, fresh: YouTubeFreshness = freshness) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setPlayingId(null);
    try {
      const res = await api.getYouTubeDiscover(refresh, fresh);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run an active custom search when the freshness window changes
  // so the user doesn't have to manually re-search after toggling
  // "Past week" / "Past month".
  const runSearch = async (q: string, fresh: YouTubeFreshness = freshness) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    setPlayingId(null);
    try {
      const res = await api.searchYouTube(trimmed, fresh);
      setSearchActive(res);
      // Push to recent — front of the list, dedupe, cap to RECENT_MAX.
      const next = [trimmed, ...recentSearches.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_MAX);
      setRecentSearches(next);
      persistRecentSearches(next);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const handleFreshnessChange = (next: YouTubeFreshness) => {
    if (next === freshness) return;
    setFreshness(next);
    try {
      localStorage.setItem(FRESHNESS_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    void load(false, next);
    if (searchActive) void runSearch(searchActive.query, next);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchActive(null);
    setSearchInput("");
    setSearchError(null);
    searchInputRef.current?.focus();
  };

  const removeRecent = (q: string) => {
    const next = recentSearches.filter((s) => s !== q);
    setRecentSearches(next);
    persistRecentSearches(next);
  };

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
                      r.video_id === videoId ? { ...r, already_saved_card_id: savedCardId } : r,
                    ),
                  }
                : th,
            ),
          }
        : prev,
    );
    // Also patch a matching row in the custom-search results if visible.
    setSearchActive((prev) =>
      prev
        ? {
            ...prev,
            results: prev.results.map((r) =>
              r.video_id === videoId ? { ...r, already_saved_card_id: savedCardId } : r,
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
      {/* Desktop theme + recent-search sidebar */}
      <aside className="panel-elevated relative hidden w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 md:flex">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
            <Sparkles className="h-3 w-3" />
            {t("discover.themes", { defaultValue: "Themen" })}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="py-2">
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

          {recentSearches.length > 0 && (
            <div className="border-t border-ink-800 pt-2 pb-3">
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                {t("discover.recent", { defaultValue: "Letzte Suchen" })}
              </div>
              <ul>
                {recentSearches.map((q) => (
                  <li key={q}>
                    <RecentSearchRow
                      label={q}
                      active={searchActive?.query.toLowerCase() === q.toLowerCase()}
                      onClick={() => {
                        setSearchInput(q);
                        void runSearch(q);
                      }}
                      onRemove={() => removeRecent(q)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          icon={Sparkles}
          tone="violet"
          title={t("discover.title", { defaultValue: "Für dich auf YouTube" })}
          subtitle={
            data && data.api_enabled && totalCards > 0
              ? t("discover.lead", {
                  count: totalCards,
                  defaultValue:
                    "{{count}} Karten in deiner Library haben das Themen-Set gespeist.",
                })
              : undefined
          }
          action={
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              aria-label={t("discover.refresh", { defaultValue: "Neu generieren" }) ?? ""}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-900 shadow-sm transition hover:bg-ink-200 disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-2 sm:rounded-md sm:px-3 sm:py-2 sm:text-sm sm:font-medium"
            >
              <RefreshCw className={["h-4 w-4", refreshing ? "animate-spin" : ""].join(" ")} />
              <span className="hidden sm:inline">
                {t("discover.refresh", { defaultValue: "Neu generieren" })}
              </span>
            </button>
          }
        />

        {/* Toolbar — search bar + freshness selector */}
        <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60">
          <div className="mx-auto max-w-6xl px-3 py-2 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={handleSearchSubmit}
                className="relative inline-flex min-w-[200px] flex-1 items-center"
              >
                <SearchIcon className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-ink-500" />
                <input
                  ref={searchInputRef}
                  // `type="text"` (not "search") — Safari/Chrome render
                  // their own clear-X for type=search, which collided
                  // with our custom one and showed two X's stacked.
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={
                    t("discover.searchPlaceholder", {
                      defaultValue: "Auf YouTube suchen — z. B. MCP server tutorial 2026",
                    }) ?? ""
                  }
                  className="h-9 w-full rounded-md border border-ink-700 bg-ink-800/60 pl-9 pr-16 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
                />
                <div className="absolute right-1 flex items-center gap-0.5">
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput("")}
                      aria-label={t("common.clear", { defaultValue: "Leeren" }) ?? ""}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-500 hover:text-ink-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <VoiceRecordButton
                    onTranscribed={(text) => {
                      const next = (searchInput + " " + text).trim();
                      setSearchInput(next);
                      void runSearch(next);
                    }}
                    showStatusLine={false}
                  />
                </div>
              </form>
              <FreshnessSelect
                value={freshness}
                onChange={handleFreshnessChange}
                disabled={loading || refreshing || searching}
              />
            </div>
          </div>
        </div>

        {/* Mobile theme chips */}
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

        {/* Mobile recent-search chips — desktop shows these in the
         *  sidebar so we hide from md upward. Sits in its own band
         *  below the theme chips, also horizontal-scrollable so a
         *  long history doesn't force the page to grow vertically. */}
        {recentSearches.length > 0 && (
          <div className="mx-auto flex w-full max-w-6xl flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-ink-800 bg-ink-950/30 px-3 py-1.5 md:hidden">
            <span className="flex-shrink-0 text-[9px] uppercase tracking-wider text-ink-500">
              {t("discover.recent", { defaultValue: "Letzte Suchen" })}:
            </span>
            {recentSearches.map((q) => (
              <RecentChip
                key={q}
                label={q}
                active={searchActive?.query.toLowerCase() === q.toLowerCase()}
                onClick={() => {
                  setSearchInput(q);
                  void runSearch(q);
                }}
                onRemove={() => removeRecent(q)}
              />
            ))}
          </div>
        )}

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="mx-auto max-w-6xl px-3 sm:px-6 lg:px-8">
            {/* Search results — render above the auto themes when active. */}
            {searching && (
              <div className="flex items-center gap-2 py-6 text-sm text-ink-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("discover.searching", { defaultValue: "Suche auf YouTube…" })}
              </div>
            )}
            {!searching && searchError && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                {searchError}
              </p>
            )}
            {!searching && searchActive && (
              <SearchResultsSection
                data={searchActive}
                onClose={clearSearch}
                playingId={playingId}
                onTogglePlay={togglePlay}
                onSaved={(vid, cid) => handleSaved("__search__", vid, cid)}
              />
            )}

            {/* Auto-themed sections */}
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

function SearchResultsSection({
  data,
  onClose,
  playingId,
  onTogglePlay,
  onSaved,
}: {
  data: YouTubeCustomSearch;
  onClose: () => void;
  playingId: string | null;
  onTogglePlay: (videoId: string) => void;
  onSaved: (videoId: string, cardId: string) => void;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(PAGE_SIZE);
  // Reset paging when the underlying search changes.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [data.query, data.freshness]);

  const items = data.results.slice(0, visible);
  const hasMore = visible < data.results.length;

  return (
    <section className="border-b border-ink-800 py-4">
      <header className="mb-2 flex items-baseline justify-between gap-3 px-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <SearchIcon className="h-3.5 w-3.5 text-violet-300" />
          {t("discover.searchResultsFor", {
            defaultValue: "Suchergebnisse für {{query}}",
            query: data.query,
          })}
          <span className="font-normal text-[11px] text-ink-500">
            · {data.results.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-400 transition hover:text-ink-100"
        >
          <X className="h-3 w-3" />
          {t("discover.closeSearch", { defaultValue: "Schließen" })}
        </button>
      </header>

      {data.results.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-4 py-6 text-center text-xs text-ink-500">
          {t("discover.searchEmpty", { defaultValue: "Keine Treffer — anderes Stichwort?" })}
        </p>
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40">
            {items.map((r: YouTubeSuggestion) => (
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
                onClick={() => setVisible((v) => Math.min(v + PAGE_SIZE, data.results.length))}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-[12px] font-medium text-ink-900 shadow-sm transition hover:bg-ink-200"
              >
                {t("discover.loadMore", { defaultValue: "Mehr laden" })}
                <span className="text-ink-500">({data.results.length - visible})</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
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
          {t("discover.themeEmpty", { defaultValue: "Keine Treffer für dieses Thema." })}
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
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-[12px] font-medium text-ink-900 shadow-sm transition hover:bg-ink-200"
              >
                {t("discover.loadMore", { defaultValue: "Mehr laden" })}
                <span className="text-ink-500">({theme.results.length - visible})</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FreshnessSelect({
  value,
  onChange,
  disabled,
}: {
  value: YouTubeFreshness;
  onChange: (next: YouTubeFreshness) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label
      className={[
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/60 px-2 text-ink-300",
        disabled ? "opacity-50" : "hover:border-ink-500 hover:bg-ink-800/80",
      ].join(" ")}
      title={t("discover.freshness.label", { defaultValue: "Zeitraum" }) ?? ""}
    >
      <span className="hidden text-[11px] sm:inline">
        {t("discover.freshness.label", { defaultValue: "Zeitraum" })}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as YouTubeFreshness)}
        disabled={disabled}
        className="appearance-none bg-transparent text-[12px] font-medium text-ink-100 focus:outline-none"
        aria-label={t("discover.freshness.label", { defaultValue: "Zeitraum" }) ?? ""}
      >
        {FRESHNESS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-ink-900 text-ink-100">
            {t(opt.labelKey, { defaultValue: opt.fallback })}
          </option>
        ))}
      </select>
    </label>
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
          ? "bg-ink-100 text-ink-900"
          : "border border-ink-700 text-ink-300 hover:text-ink-100",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span
        className={["rounded px-1 text-[9px]", active ? "bg-ink-900/15" : "text-ink-500"].join(" ")}
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

/** Compact pill for mobile (horizontal-scroll band under theme chips).
 *  Desktop uses <RecentSearchRow> in the sidebar instead. */
function RecentChip({
  label,
  active,
  onClick,
  onRemove,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      className={[
        "inline-flex flex-shrink-0 items-center gap-0.5 rounded-full border text-[11px] transition",
        active
          ? "border-ink-100/40 bg-ink-100 text-ink-900"
          : "border-ink-700 bg-ink-800/40 text-ink-300 hover:border-ink-500 hover:text-ink-100",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="max-w-[180px] truncate px-2.5 py-0.5 text-left"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove"
        className={[
          "inline-flex h-5 w-5 items-center justify-center rounded-full transition",
          active ? "text-ink-900/60 hover:text-ink-900" : "text-ink-500 hover:text-ink-100",
        ].join(" ")}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Sidebar row that re-runs a past search. Matches the visual rhythm
 *  of <ThemeNavButton> — single-line item with the X visible only on
 *  hover/focus so the row stays readable in long lists. */
function RecentSearchRow({
  label,
  active,
  onClick,
  onRemove,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={[
        "group flex w-full items-center gap-1 px-2 transition",
        active ? "bg-ink-800/70" : "hover:bg-ink-800/40",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={[
          "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-xs transition",
          active ? "text-ink-100" : "text-ink-300 group-hover:text-ink-100",
        ].join(" ")}
      >
        <SearchIcon className="h-3 w-3 flex-shrink-0 text-ink-500" />
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove"
        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-ink-600 opacity-0 transition hover:bg-ink-700 hover:text-ink-100 focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
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

