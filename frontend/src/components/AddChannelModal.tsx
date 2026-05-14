/* Modal for subscribing to a YouTube channel.
 *
 * Three sub-tabs:
 *   - search    : query → /api/channels/search (Data API, 100 units)
 *   - paste     : URL/handle → /api/channels/resolve (1 unit + maybe 100 fallback)
 *   - suggested : /api/channels/suggestions, library-derived (free)
 *
 * After Subscribe, the row appears in the parent Discover sidebar via
 * an onSubscribed callback (parent re-fetches the channels list).
 */

import { Loader2, Search as SearchIcon, Sparkles, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type ChannelSearchResult,
  type ChannelSubscription,
  type ChannelSuggestion,
} from "../lib/api";

type Tab = "search" | "paste" | "suggested";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubscribed: (sub: ChannelSubscription) => void;
  /** Channel ids already subscribed — hidden from the result lists so
   *  the user can't double-subscribe. */
  alreadySubscribed: Set<string>;
}

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

  // Paste tab
  const [pasteInput, setPasteInput] = useState("");
  const [pasteResult, setPasteResult] = useState<ChannelSearchResult | null>(
    null,
  );
  const [resolving, setResolving] = useState(false);

  // Suggested tab
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Per-row "subscribing" indicator.
  const [subscribingId, setSubscribingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearchInput("");
    setSearchResults([]);
    setPasteInput("");
    setPasteResult(null);
    setSubscribingId(null);
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
    // Focus the search input on open.
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.searchChannels(q);
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

  const subscribe = async (channelId: string) => {
    setSubscribingId(channelId);
    setError(null);
    try {
      const sub = await api.subscribeChannel(channelId);
      onSubscribed(sub);
      // Drop the entry from local result/suggestion arrays to give
      // immediate feedback.
      setSearchResults((rows) =>
        rows.filter((r) => r.channel_id !== channelId),
      );
      setSuggestions((rows) =>
        rows.filter((r) => r.channel_id !== channelId),
      );
      if (pasteResult?.channel_id === channelId) {
        setPasteResult(null);
        setPasteInput("");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubscribingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/80 px-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel-elevated w-full max-w-2xl rounded-xl border border-ink-800 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
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
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-ink-800 bg-ink-950/30 px-3">
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
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={t("discover.channels.addModal.fromLibrary", {
              defaultValue: "Aus deiner Library",
            })}
          />
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
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
                onSubscribe={subscribe}
                subscribingId={subscribingId}
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
                  onSubscribe={subscribe}
                  subscribingId={subscribingId}
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
                <ResultList
                  items={suggestions}
                  alreadySubscribed={alreadySubscribed}
                  onSubscribe={subscribe}
                  subscribingId={subscribingId}
                  showCardCount
                />
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
  onSubscribe,
  subscribingId,
  emptyHint,
  showCardCount,
}: {
  items: T[];
  alreadySubscribed: Set<string>;
  onSubscribe: (channelId: string) => void;
  subscribingId: string | null;
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
        const isMine = alreadySubscribed.has(it.channel_id);
        const isWorking = subscribingId === it.channel_id;
        return (
          <li key={it.channel_id} className="flex items-center gap-3 px-3 py-2.5">
            {it.thumbnail_url ? (
              <img
                src={it.thumbnail_url}
                alt=""
                className="h-9 w-9 flex-shrink-0 rounded-full bg-ink-800 object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-ink-400">
                {it.title.slice(0, 1).toUpperCase()}
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
            <button
              type="button"
              onClick={() => onSubscribe(it.channel_id)}
              disabled={isMine || isWorking}
              className={[
                "inline-flex h-7 items-center gap-1 rounded-md px-3 text-[11px] font-medium transition",
                isMine
                  ? "cursor-default border border-ink-700 text-ink-500"
                  : "bg-ink-100 text-ink-900 hover:bg-ink-200",
                isWorking ? "opacity-60" : "",
              ].join(" ")}
            >
              {isWorking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {isMine
                ? t("discover.channels.subscribed", {
                    defaultValue: "Abonniert",
                  })
                : t("discover.channels.subscribe", {
                    defaultValue: "Abonnieren",
                  })}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
