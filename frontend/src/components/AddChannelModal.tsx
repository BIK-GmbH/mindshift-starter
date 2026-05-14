/* Modal for subscribing to a YouTube channel.
 *
 * Three sub-tabs:
 *   - search    : query → /api/channels/search (Data API, 100 units)
 *   - paste     : URL/handle → /api/channels/resolve (1 unit + maybe 100 fallback)
 *   - suggested : /api/channels/suggestions, library-derived (free)
 *
 * Inline-subscribe flow: clicking "Abonnieren" subscribes the row in
 * place and the row flips to "✓ Abonniert · <mode>". The modal stays
 * open so the user can chain several subscribes. Each row has a small
 * `⚡ Auto` toggle that decides whether the subscription is created in
 * manual or auto-ingest mode — set BEFORE clicking Abonnieren.
 *
 * Suggestions tab additionally shows a "Alle N abonnieren" bulk button
 * with its own auto toggle, since that list is already curated from
 * the user's library and bulk-subscribe is the common case.
 */

import {
  Check,
  Loader2,
  Search as SearchIcon,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type ChannelIngestMode,
  type ChannelSearchResult,
  type ChannelSubscription,
  type ChannelSuggestion,
} from "../lib/api";

type Tab = "search" | "paste" | "suggested";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after EACH successful subscribe so the parent can update
   *  the sidebar in real time. The modal stays open. */
  onSubscribed: (sub: ChannelSubscription) => void;
  /** Channel ids already subscribed elsewhere (e.g. before opening the
   *  modal). Used to show "Abonniert" on a row from the start. */
  alreadySubscribed: Set<string>;
}

/** Per-row state tracked inside the modal. */
interface RowState {
  mode: ChannelIngestMode;
  /** Subscribed state — once true, the row stays as "✓ Abonniert" until
   *  the modal is reopened. */
  subscribed: boolean;
  /** Network in-flight indicator. */
  busy: boolean;
}

const DEFAULT_ROW_STATE: RowState = {
  mode: "manual",
  subscribed: false,
  busy: false,
};

export default function AddChannelModal({
  open,
  onClose,
  onSubscribed,
  alreadySubscribed,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("search");
  const [error, setError] = useState<string | null>(null);

  // Search tab
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<ChannelSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Cache: query → results, alive for the modal's lifetime. Channel
  // search costs 100 Data-API units per call (out of a 10k/day quota),
  // so re-submitting the same query — accidentally double-clicking,
  // tab-flipping back to "Search" — must NOT burn another 100 units.
  const searchCacheRef = useRef<Map<string, ChannelSearchResult[]>>(new Map());

  // Paste tab
  const [pasteInput, setPasteInput] = useState("");
  const [pasteResult, setPasteResult] = useState<ChannelSearchResult | null>(
    null,
  );
  const [resolving, setResolving] = useState(false);

  // Suggested tab
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Per-row state across all tabs, keyed by channel_id.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // Bulk action state for the Suggestions tab.
  const [bulkMode, setBulkMode] = useState<ChannelIngestMode>("manual");
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearchInput("");
    setSearchResults([]);
    setPasteInput("");
    setPasteResult(null);
    setRowStates({});
    setBulkMode("manual");
    searchCacheRef.current.clear();
    // Pre-fetch suggestions in the background so switching to the tab
    // is instant — they are free (no API quota).
    setSuggestionsLoading(true);
    api
      .getChannelSuggestions()
      .then(setSuggestions)
      .catch(() => {
        // Non-fatal — the tab will just show an empty state.
      })
      .finally(() => setSuggestionsLoading(false));
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const setRowState = (channelId: string, patch: Partial<RowState>) => {
    setRowStates((prev) => ({
      ...prev,
      [channelId]: { ...DEFAULT_ROW_STATE, ...(prev[channelId] ?? {}), ...patch },
    }));
  };

  const getRowState = (channelId: string): RowState =>
    rowStates[channelId] ?? DEFAULT_ROW_STATE;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q || searching) return;
    const cacheKey = q.toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setSearchResults(cached);
      setError(
        cached.length === 0
          ? t("discover.channels.noSearchResults", {
              defaultValue: "Keine Channels gefunden.",
            })
          : null,
      );
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await api.searchChannels(q);
      searchCacheRef.current.set(cacheKey, res);
      setSearchResults(res);
      if (res.length === 0) {
        setError(
          t("discover.channels.noSearchResults", {
            defaultValue: "Keine Channels gefunden.",
          }),
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = pasteInput.trim();
    if (!v) return;
    setResolving(true);
    setError(null);
    setPasteResult(null);
    try {
      const res = await api.resolveChannel(v);
      setPasteResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolving(false);
    }
  };

  /** Subscribe one channel honoring its per-row mode setting. */
  const subscribeOne = async (channelId: string, mode: ChannelIngestMode) => {
    if (!channelId) return;
    setRowState(channelId, { busy: true });
    try {
      const sub = await api.subscribeChannel(channelId);
      // If the user chose auto, flip the mode on the freshly-created
      // subscription. No confirm dialog here — the toggle was an
      // explicit, deliberate gesture.
      let final = sub;
      if (mode === "auto") {
        try {
          final = await api.patchChannel(sub.id, { ingest_mode: "auto" });
        } catch {
          // Subscribe still succeeded; just couldn't flip the mode.
          // The user can switch in the channel detail later.
        }
      }
      onSubscribed(final);
      setRowState(channelId, {
        subscribed: true,
        busy: false,
        mode: final.ingest_mode,
      });
    } catch (err) {
      setError((err as Error).message);
      setRowState(channelId, { busy: false });
    }
  };

  const toggleRowMode = (channelId: string) => {
    if (!channelId) return;
    const current = getRowState(channelId);
    if (current.subscribed) return;
    setRowState(channelId, {
      mode: current.mode === "auto" ? "manual" : "auto",
    });
  };

  /** "Alle abonnieren" — walk the suggestions, skip the ones already
   *  subscribed (in this session or before), subscribe sequentially. */
  const subscribeAll = async () => {
    setBulkBusy(true);
    setError(null);
    try {
      for (const s of suggestions) {
        if (!s.channel_id) continue;
        if (alreadySubscribed.has(s.channel_id)) continue;
        if (getRowState(s.channel_id).subscribed) continue;
        await subscribeOne(s.channel_id, bulkMode);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  // Count remaining unsubscribed suggestions (for the bulk-button label).
  const remainingBulk = suggestions.filter(
    (s) =>
      s.channel_id &&
      !alreadySubscribed.has(s.channel_id) &&
      !getRowState(s.channel_id).subscribed,
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 backdrop-blur-sm sm:items-start sm:px-4 sm:pt-20"
      onClick={onClose}
    >
      <div
        className="panel-elevated w-full overflow-hidden rounded-t-2xl border-t border-ink-800 bg-ink-900 shadow-2xl sm:max-w-2xl sm:rounded-xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3 sm:px-5">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
            <Users className="h-4 w-4 text-violet-300" />
            {t("discover.channels.addModal.title", {
              defaultValue: "Channel abonnieren",
            })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", { defaultValue: "Schließen" }) ?? ""}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs — horizontal-scrollable on mobile so long labels never
         *  break onto a second row. */}
        <div className="flex gap-1 overflow-x-auto border-b border-ink-800 bg-ink-950/30 px-2 sm:px-3">
          <TabButton
            active={tab === "search"}
            onClick={() => setTab("search")}
            icon={<SearchIcon className="h-3.5 w-3.5" />}
            label={t("discover.channels.addModal.search", {
              defaultValue: "Suchen",
            })}
          />
          <TabButton
            active={tab === "paste"}
            onClick={() => setTab("paste")}
            icon={<span className="text-[11px] font-bold">URL</span>}
            label={t("discover.channels.addModal.paste", {
              defaultValue: "URL einfügen",
            })}
          />
          <TabButton
            active={tab === "suggested"}
            onClick={() => setTab("suggested")}
            icon={<Users className="h-3.5 w-3.5" />}
            label={t("discover.channels.addModal.fromLibrary", {
              defaultValue: "Aus deiner Library",
            })}
          />
        </div>

        {/* Content — sheet style on mobile (≤70 vh) gives room for the
         *  bottom safe-area; centered on desktop. */}
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-8 pt-4 sm:max-h-[60vh] sm:px-5 sm:pb-4">
          {error && (
            <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {tab === "search" && (
            <>
              <form onSubmit={handleSearch} className="mb-3 flex gap-2">
                <input
                  ref={searchRef}
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={
                    t("discover.channels.addModal.searchPlaceholder", {
                      defaultValue: "Channel-Name, z. B. Lex Fridman",
                    }) ?? ""
                  }
                  className="h-9 flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={searching || !searchInput.trim()}
                  className="inline-flex h-9 items-center gap-1 rounded-md bg-ink-100 px-3 text-[12px] font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-40"
                >
                  {searching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SearchIcon className="h-3.5 w-3.5" />
                  )}
                  {t("common.search", { defaultValue: "Suchen" })}
                </button>
              </form>
              <ResultList
                items={searchResults}
                alreadySubscribed={alreadySubscribed}
                rowStateFor={getRowState}
                onToggleMode={toggleRowMode}
                onSubscribe={subscribeOne}
                emptyHint={
                  t("discover.channels.addModal.searchHint", {
                    defaultValue:
                      "Tippe den Namen eines Creators ein. Wir nutzen die YouTube-Datenbank.",
                  }) ?? ""
                }
              />
            </>
          )}

          {tab === "paste" && (
            <>
              <form onSubmit={handleResolve} className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={pasteInput}
                  onChange={(e) => setPasteInput(e.target.value)}
                  placeholder={
                    t("discover.channels.addModal.pastePlaceholder", {
                      defaultValue:
                        "youtube.com/@handle, /channel/UC…, oder ein Video-Link",
                    }) ?? ""
                  }
                  className="h-9 flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={resolving || !pasteInput.trim()}
                  className="inline-flex h-9 items-center gap-1 rounded-md bg-ink-100 px-3 text-[12px] font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-40"
                >
                  {resolving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("discover.channels.addModal.resolve", {
                    defaultValue: "Auflösen",
                  })}
                </button>
              </form>
              {pasteResult ? (
                <ResultList
                  items={[pasteResult]}
                  alreadySubscribed={alreadySubscribed}
                  rowStateFor={getRowState}
                  onToggleMode={toggleRowMode}
                  onSubscribe={subscribeOne}
                />
              ) : (
                <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-3 py-6 text-center text-xs text-ink-500">
                  {t("discover.channels.addModal.pasteHint", {
                    defaultValue:
                      "Füge eine YouTube-URL oder @handle ein. Wir lösen sie automatisch zu einem Channel auf.",
                  })}
                </p>
              )}
            </>
          )}

          {tab === "suggested" && (
            <>
              {suggestionsLoading ? (
                <p className="flex items-center gap-2 text-xs text-ink-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("common.loading", { defaultValue: "Lädt…" })}
                </p>
              ) : suggestions.length === 0 ? (
                <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-3 py-6 text-center text-xs text-ink-500">
                  {t("discover.channels.addModal.suggestionsEmpty", {
                    defaultValue:
                      "Wir empfehlen Channels, sobald du ein paar YouTube-Karten gespeichert hast.",
                  })}
                </p>
              ) : (
                <>
                  <ResultList
                    items={suggestions}
                    alreadySubscribed={alreadySubscribed}
                    rowStateFor={getRowState}
                    onToggleMode={toggleRowMode}
                    onSubscribe={subscribeOne}
                    showCardCount
                  />
                  {remainingBulk > 1 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-ink-700 bg-ink-900/60 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setBulkMode((m) => (m === "auto" ? "manual" : "auto"))
                        }
                        title={
                          t("discover.channels.bulk.autoTooltip", {
                            defaultValue:
                              "Auto-Ingest für die Sammel-Aktion aktivieren",
                          }) ?? ""
                        }
                        className={[
                          "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition sm:h-6 sm:px-2 sm:text-[10px]",
                          bulkMode === "auto"
                            ? "border-violet-500 bg-violet-500/15 text-violet-200"
                            : "border-ink-700 text-ink-400 hover:text-ink-100",
                        ].join(" ")}
                      >
                        <Zap className="h-3 w-3" />
                        {t("discover.channels.autoIngest.short", {
                          defaultValue: "Auto",
                        })}
                      </button>
                      <span className="min-w-0 flex-1 text-[11px] text-ink-400 sm:flex-none">
                        {bulkMode === "auto"
                          ? t("discover.channels.bulk.modeAuto", {
                              defaultValue:
                                "Neue Uploads automatisch ingesten",
                            })
                          : t("discover.channels.bulk.modeManual", {
                              defaultValue:
                                "Nur abonnieren — manuell speichern",
                            })}
                      </span>
                      <span className="ml-auto hidden sm:block" />
                      <button
                        type="button"
                        onClick={subscribeAll}
                        disabled={bulkBusy}
                        className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-violet-500 px-3 text-[12px] font-medium text-white transition hover:bg-violet-400 disabled:opacity-50 sm:h-7 sm:w-auto sm:text-[11px]"
                      >
                        {bulkBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-3 sm:w-3" />
                        ) : null}
                        {t("discover.channels.bulk.subscribeAll", {
                          count: remainingBulk,
                          defaultValue: "Alle {{count}} abonnieren",
                        })}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 px-3 py-2 text-xs transition border-b-2",
        active
          ? "border-violet-400 text-ink-100"
          : "border-transparent text-ink-400 hover:text-ink-100",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function ResultList<
  T extends ChannelSearchResult & Partial<ChannelSuggestion>,
>({
  items,
  alreadySubscribed,
  rowStateFor,
  onToggleMode,
  onSubscribe,
  emptyHint,
  showCardCount,
}: {
  items: T[];
  alreadySubscribed: Set<string>;
  rowStateFor: (channelId: string) => RowState;
  onToggleMode: (channelId: string) => void;
  onSubscribe: (channelId: string, mode: ChannelIngestMode) => Promise<void>;
  emptyHint?: string;
  showCardCount?: boolean;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return emptyHint ? (
      <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-3 py-6 text-center text-xs text-ink-500">
        {emptyHint}
      </p>
    ) : null;
  }
  return (
    <ul className="divide-y divide-ink-800 overflow-hidden rounded-md border border-ink-800 bg-ink-900/40">
      {items.map((it) => {
        const wasAlreadyMine = alreadySubscribed.has(it.channel_id);
        const rowState = rowStateFor(it.channel_id);
        const isSubscribed = wasAlreadyMine || rowState.subscribed;
        return (
          <li key={it.channel_id || it.title} className="flex items-center gap-3 px-3 py-2.5">
            {it.thumbnail_url ? (
              <img
                src={it.thumbnail_url}
                alt=""
                referrerPolicy="no-referrer"
                className="h-9 w-9 flex-shrink-0 rounded-full bg-ink-800 object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-ink-400">
                {(it.title || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-100">
                {it.title || it.channel_id}
              </p>
              <p className="truncate text-[11px] text-ink-500">
                {[
                  it.handle,
                  it.subscriber_count != null
                    ? `${formatSubs(it.subscriber_count)} ${t(
                        "discover.channels.subscribers",
                        { defaultValue: "Abos" },
                      )}`
                    : null,
                  showCardCount && it.card_count_in_library != null
                    ? t("discover.channels.suggestions.cardsInLibrary", {
                        count: it.card_count_in_library,
                        defaultValue: "{{count}} Karten in deiner Library",
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <RowActions
              channelId={it.channel_id}
              rowState={rowState}
              isSubscribed={isSubscribed}
              onToggleMode={onToggleMode}
              onSubscribe={onSubscribe}
            />
          </li>
        );
      })}
    </ul>
  );
}

function RowActions({
  channelId,
  rowState,
  isSubscribed,
  onToggleMode,
  onSubscribe,
}: {
  channelId: string;
  rowState: RowState;
  isSubscribed: boolean;
  onToggleMode: (channelId: string) => void;
  onSubscribe: (channelId: string, mode: ChannelIngestMode) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Title-only suggestion rows (no channel_id) can't be subscribed
  // automatically — the user has to use Search/URL tabs.
  if (!channelId) {
    return (
      <span className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-500">
        {t("discover.channels.suggestions.searchToSubscribe", {
          defaultValue: "Über Suche abonnieren",
        })}
      </span>
    );
  }

  if (isSubscribed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <Check className="h-3 w-3" />
        {t("discover.channels.subscribed", { defaultValue: "Abonniert" })}
        <span className="text-emerald-400/60">
          ·{" "}
          {rowState.mode === "auto"
            ? t("discover.channels.autoIngest.short", { defaultValue: "Auto" })
            : t("discover.channels.modeManual", { defaultValue: "Manuell" })}
        </span>
      </span>
    );
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onToggleMode(channelId)}
        title={
          t("discover.channels.autoIngest.tooltip", {
            defaultValue: "Auto-Ingest beim Abonnieren aktivieren",
          }) ?? ""
        }
        aria-pressed={rowState.mode === "auto"}
        className={[
          "inline-flex h-9 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition sm:h-7 sm:px-2 sm:text-[10px]",
          rowState.mode === "auto"
            ? "border-violet-500 bg-violet-500/15 text-violet-200"
            : "border-ink-700 text-ink-400 hover:text-ink-100",
        ].join(" ")}
      >
        <Zap className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        {t("discover.channels.autoIngest.short", { defaultValue: "Auto" })}
      </button>
      <button
        type="button"
        onClick={() => onSubscribe(channelId, rowState.mode)}
        disabled={rowState.busy}
        className="inline-flex h-9 items-center gap-1 rounded-md bg-ink-100 px-3 text-[12px] font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50 sm:h-7 sm:text-[11px]"
      >
        {rowState.busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-3 sm:w-3" />
        ) : null}
        {t("discover.channels.subscribe", { defaultValue: "Abonnieren" })}
      </button>
    </div>
  );
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
