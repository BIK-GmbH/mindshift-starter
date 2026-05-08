import {
  ChevronDown,
  FileText,
  Globe,
  Hash,
  LayoutGrid,
  List as ListIcon,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search as SearchIcon,
  StickyNote,
  X,
  Youtube,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import AddContentModal from "../components/AddYouTubeModal";
import CardDetailContent from "../components/CardDetailContent";
import ChatPanel from "../components/ChatPanel";
import StatusBadge from "../components/StatusBadge";
import TagsTree, { type TagsTreeHandle } from "../components/TagsTree";
import { playHover, playSound } from "../lib/sounds";
import { useSearchModal } from "../lib/SearchModalContext";
import { api, type CardListItem } from "../lib/api";

interface SourceMeta {
  Icon: FC<{ className?: string; strokeWidth?: number | string }>;
  /** Foreground colour for the icon glyph. */
  color: string;
  /** Tailwind classes for the gradient + ring used in thumbnail fallbacks. */
  fallback: string;
  /** Solid badge background when shown over a card thumbnail. */
  badge: string;
}

const SOURCE_META: Record<string, SourceMeta> = {
  youtube: {
    Icon: Youtube,
    color: "text-red-400",
    fallback: "from-red-500/20 via-red-500/5 to-transparent",
    badge: "bg-red-500/90 text-white",
  },
  article: {
    Icon: Globe,
    color: "text-sky-300",
    fallback: "from-sky-500/20 via-sky-500/5 to-transparent",
    badge: "bg-sky-500/90 text-white",
  },
  pdf: {
    Icon: FileText,
    color: "text-rose-300",
    fallback: "from-rose-500/20 via-rose-500/5 to-transparent",
    badge: "bg-rose-500/90 text-white",
  },
  note: {
    Icon: StickyNote,
    color: "text-amber-300",
    fallback: "from-amber-500/20 via-amber-500/5 to-transparent",
    badge: "bg-amber-500/90 text-white",
  },
};

const FALLBACK_META: SourceMeta = {
  Icon: FileText,
  color: "text-ink-300",
  fallback: "from-ink-700/40 via-ink-800/20 to-transparent ring-ink-700/40",
  badge: "bg-ink-700 text-ink-100",
};

const RIGHT_PANE_KEY = "mindshift.libraryRightPane";

export default function LibraryPage() {
  const { t } = useTranslation();
  const { openModal: openSearch } = useSearchModal();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag");
  const untaggedFilter = params.get("untagged") === "1";
  const selectedCardId = params.get("card");
  const sourceFilter = params.get("src") ?? "";
  const sort = (params.get("sort") as "newest" | "oldest" | "title" | null) ?? "newest";
  const view = (params.get("view") === "list" ? "list" : "grid") as "grid" | "list";
  const [rightPaneOpen, setRightPaneOpen] = useState(() => {
    try {
      const v = localStorage.getItem(RIGHT_PANE_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const fetchCards = useCallback(async () => {
    try {
      const list = await api.listCards({
        tag: tag ?? undefined,
        untagged: untaggedFilter || undefined,
        source_type: sourceFilter || undefined,
        sort,
      });
      setCards(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tag, untaggedFilter, sourceFilter, sort]);

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete("tag");
    next.delete("untagged");
    setParams(next);
  };

  const setSearchParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const hasInflight = cards.some((c) => c.status === "queued" || c.status === "processing");
    if (!hasInflight) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    if (pollTimerRef.current) return;
    pollTimerRef.current = window.setInterval(() => void fetchCards(), 2500);
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [cards, fetchCards]);

  const counts = cards.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.status === "completed") acc.completed += 1;
      if (c.status === "failed") acc.failed += 1;
      if (c.status === "processing" || c.status === "queued") acc.inflight += 1;
      return acc;
    },
    { total: 0, completed: 0, failed: 0, inflight: 0 },
  );

  const openCard = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("card", id);
    setParams(next, { replace: false });
  };

  const closeCard = () => {
    const next = new URLSearchParams(params);
    next.delete("card");
    setParams(next, { replace: false });
  };

  const toggleRightPane = () => {
    const next = !rightPaneOpen;
    setRightPaneOpen(next);
    try {
      localStorage.setItem(RIGHT_PANE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Detail mode: card is open in the middle, optional chat side pane on the right.
  if (selectedCardId) {
    return (
      <div className="flex h-full">
        <LibraryTagsSidebar />
        <div className="flex flex-1 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <CardDetailContent
              cardId={selectedCardId}
              onBack={closeCard}
              backStyle="link"
              compact
              hideChatTab={rightPaneOpen}
            />
          </div>
          {rightPaneOpen ? (
            <aside className="pane-enter-right panel-elevated-right hidden lg:flex w-[40%] min-w-[360px] max-w-[640px] flex-col border-l border-ink-800 bg-ink-900/40">
              <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  <MessageSquare className="h-3 w-3" />
                  {t("nav.chat")}
                </div>
                <button
                  type="button"
                  onClick={toggleRightPane}
                  title={t("library.rightPane.hide") ?? ""}
                  className="rounded p-1 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-1 min-h-0 flex-col px-4 pb-4 pt-3">
                <ChatPanel
                  key={selectedCardId}
                  send={(history) => api.chatCard(selectedCardId, history)}
                  placeholder={t("chat.placeholderCard") ?? ""}
                  emptyHint={t("chat.cardEmpty") ?? ""}
                />
              </div>
            </aside>
          ) : (
            <button
              type="button"
              onClick={toggleRightPane}
              title={t("library.rightPane.show") ?? ""}
              className="flex w-8 flex-col items-center justify-center border-l border-ink-800 bg-ink-900/40 text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Grid mode: no card selected.
  return (
    <div className="flex h-full">
      <LibraryTagsSidebar />
      <div className="flex flex-1 min-w-0 flex-col">
      {/* Title band — same height across pages */}
      <div className="page-header">
        <div className="page-header-inner flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="page-header-title">{t("nav.library")}</h1>
            {counts.total > 0 && (
              <p className="page-header-subtitle flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                <span>
                  <span className="font-medium tabular-nums text-ink-200">{counts.total}</span>{" "}
                  {t("library.stats.cards")}
                </span>
                {counts.completed > 0 && (
                  <>
                    <span className="text-ink-600">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {counts.completed} {t("library.stats.completed")}
                    </span>
                  </>
                )}
                {counts.inflight > 0 && (
                  <>
                    <span className="text-ink-600">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      {counts.inflight} {t("library.stats.processing")}
                    </span>
                  </>
                )}
                {counts.failed > 0 && (
                  <>
                    <span className="text-ink-600">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      {counts.failed} {t("library.stats.failed")}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              playSound("click");
              setModalOpen(true);
            }}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 shadow-sm transition hover:bg-ink-200"
          >
            <Plus className="h-4 w-4" />
            {t("library.addContent")}
          </button>
        </div>
      </div>

      {/* Toolbar strip — search + filters + view toggle */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60">
        <div className="mx-auto max-w-6xl px-8 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="inline-flex flex-1 min-w-[200px] max-w-md items-center gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-left text-sm text-ink-500 transition hover:border-ink-500 hover:bg-ink-800/80"
            >
              <SearchIcon className="h-3.5 w-3.5 text-ink-500" />
              <span className="flex-1 truncate">{t("library.search")}</span>
              <kbd className="hidden rounded border border-ink-700 bg-ink-900/50 px-1.5 py-0.5 text-[10px] font-mono text-ink-400 sm:inline-block">
                ⌘K
              </kbd>
            </button>

            <SelectPill
              value={sourceFilter}
              onChange={(v) => setSearchParam("src", v)}
              options={[
                { value: "", label: t("library.toolbar.allSources", { defaultValue: "All sources" }) },
                { value: "youtube", label: "YouTube" },
                { value: "article", label: t("addContent.article") },
                { value: "pdf", label: "PDF" },
                { value: "note", label: t("addContent.tab.note") },
              ]}
            />

            <SelectPill
              value={sort}
              onChange={(v) => setSearchParam("sort", v === "newest" ? "" : v)}
              options={[
                { value: "newest", label: t("library.toolbar.newest", { defaultValue: "Newest first" }) },
                { value: "oldest", label: t("library.toolbar.oldest", { defaultValue: "Oldest first" }) },
                { value: "title", label: t("library.toolbar.title", { defaultValue: "Title A–Z" }) },
              ]}
            />


            {(tag || untaggedFilter) && (
              <div className="flex items-center gap-1.5 text-[11px]">
                {tag && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-700/70 px-2.5 py-0.5 font-medium text-ink-100 ring-1 ring-ink-600">
                    <Hash className="h-3 w-3 text-ink-300" />
                    {tag}
                  </span>
                )}
                {untaggedFilter && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-700/70 px-2.5 py-0.5 font-medium italic text-ink-100 ring-1 ring-ink-600">
                    {t("tags.untagged")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
                  title={t("library.clearAll") ?? ""}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* View toggle — pinned right */}
            <div className="ml-auto flex gap-0.5 rounded-md bg-ink-800/60 p-0.5 ring-1 ring-ink-700">
              <ViewToggleButton
                Icon={LayoutGrid}
                active={view === "grid"}
                onClick={() => setSearchParam("view", "")}
                label={t("library.toolbar.viewGrid", { defaultValue: "Grid" })}
              />
              <ViewToggleButton
                Icon={ListIcon}
                active={view === "list"}
                onClick={() => setSearchParam("view", "list")}
                label={t("library.toolbar.viewList", { defaultValue: "List" })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div data-scroll-stable className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 pb-12 pt-6">
          {error && (
            <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading ? (
            <CardSkeleton count={6} />
          ) : cards.length === 0 ? (
            <EmptyState onAdd={() => setModalOpen(true)} />
          ) : view === "list" ? (
            <ul className="cards-stagger divide-y divide-ink-800 rounded-xl border border-ink-800 bg-ink-800/30">
              {cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  onClick={() => openCard(card.id)}
                />
              ))}
            </ul>
          ) : (
            <div className="cards-stagger grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  onClick={() => openCard(card.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

        <AddContentModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreated={() => void fetchCards()}
        />
      </div>
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function ViewToggleButton({
  Icon,
  active,
  onClick,
  label,
}: {
  Icon: typeof LayoutGrid;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded transition",
        active ? "bg-ink-100 text-ink-900" : "text-ink-300 hover:text-ink-100",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function CardRow({ card, onClick }: { card: CardListItem; onClick: () => void }) {
  const meta = SOURCE_META[card.source_type] ?? FALLBACK_META;
  const { Icon, color, fallback } = meta;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={playHover}
        aria-label={card.title}
        className="group flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-ink-800/40 focus-visible:bg-ink-800/40"
      >
        <div
          className={[
            "relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-md ring-1",
            card.thumbnail_url ? "ring-ink-700" : "ring-inset bg-gradient-to-br " + fallback,
          ].join(" ")}
        >
          {card.thumbnail_url ? (
            <img src={card.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Icon className={["h-7 w-7", color].join(" ")} strokeWidth={1.5} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
            <Icon className={["h-3 w-3", color].join(" ")} />
            <span className={color}>{card.source_type}</span>
            <span className="text-ink-600">·</span>
            <span className="text-ink-500">{new Date(card.created_at).toLocaleDateString()}</span>
          </div>
          <p className="truncate text-sm font-medium text-ink-100">{card.title}</p>
          {card.concise_summary_md && (
            <p className="line-clamp-1 text-xs text-ink-400">{card.concise_summary_md}</p>
          )}
        </div>

        <StatusBadge status={card.status} />
      </button>
    </li>
  );
}

function SelectPill({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  // Custom-styled wrapper around a native <select> so the toolbar pill
  // gets ink-themed colours but keeps native keyboard + accessibility.
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-md border border-ink-700 bg-ink-800/60 pl-3 pr-7 text-xs text-ink-200 transition hover:border-ink-500 focus:border-ink-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700/40"
        aria-label={current?.label ?? ""}
      >
        {options.map((o) => (
          <option key={o.value || "__default"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-ink-400" />
    </div>
  );
}

function LibraryTagsSidebar() {
  const { t } = useTranslation();
  const tagsTreeRef = useRef<TagsTreeHandle>(null);
  return (
    <aside className="panel-elevated hidden md:flex w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
          {t("nav.tags")}
        </span>
        <button
          type="button"
          onClick={() => {
            playSound("click");
            tagsTreeRef.current?.createTag();
          }}
          title={t("tags.newTag") ?? ""}
          className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[10px] font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          <Plus className="h-3 w-3" />
          {t("tags.new", { defaultValue: "New" })}
        </button>
      </div>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden py-2">
        <TagsTree ref={tagsTreeRef} />
      </div>
    </aside>
  );
}

function CardTile({ card, onClick }: { card: CardListItem; onClick: () => void }) {
  const meta = SOURCE_META[card.source_type] ?? FALLBACK_META;
  const { Icon, color, fallback, badge } = meta;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={playHover}
      aria-label={card.title}
      className="card-hover group relative flex flex-col overflow-hidden rounded-xl border border-transparent bg-ink-800/40 text-left shadow-sm hover:border-ink-600/60"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-ink-800">
        {card.thumbnail_url ? (
          <>
            <img
              src={card.thumbnail_url}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />
            {/* Source-type chip, top-left, sits above the thumbnail */}
            <span
              className={[
                "absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-md backdrop-blur-sm",
                badge,
              ].join(" ")}
            >
              <Icon className="h-3 w-3" />
              {card.source_type}
            </span>
          </>
        ) : (
          // No thumbnail → fill the aspect-video with a big, deliberately
          // sized icon so PDF / Article / Note cards don't look like the
          // ingestion failed.
          <div
            className={[
              "flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br",
              fallback,
            ].join(" ")}
          >
            <Icon className={["h-16 w-16", color].join(" ")} strokeWidth={1.5} />
            <span className={["text-[10px] font-semibold uppercase tracking-[0.16em]", color].join(" ")}>
              {card.source_type}
            </span>
          </div>
        )}
        <div className="absolute right-2 top-2">
          <StatusBadge status={card.status} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink-900/60 to-transparent" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-100">
          {card.title}
        </h3>
        {card.concise_summary_md && (
          <p className="line-clamp-3 text-xs leading-relaxed text-ink-400">
            {card.concise_summary_md}
          </p>
        )}
      </div>
    </button>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-ink-800 bg-ink-800/40"
        >
          <div className="aspect-video animate-pulse bg-ink-800" style={{ animationDelay: `${i * 60}ms` }} />
          <div className="space-y-2 p-3">
            <div className="h-3 w-1/4 animate-pulse rounded bg-ink-800" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-ink-800" />
            <div className="h-3 w-full animate-pulse rounded bg-ink-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-800/30 p-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-700/50 ring-1 ring-ink-700">
        <Plus className="h-5 w-5 text-ink-300" />
      </div>
      <h2 className="text-lg font-semibold text-ink-100">{t("library.empty.title")}</h2>
      <p className="mt-1 text-sm text-ink-400">{t("library.empty.body")}</p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-200"
      >
        <Plus className="h-4 w-4" />
        {t("library.addContent")}
      </button>
    </div>
  );
}
