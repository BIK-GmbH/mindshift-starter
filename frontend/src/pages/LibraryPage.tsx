import {
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Github,
  Globe,
  Hash,
  LayoutGrid,
  Library,
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
import CardAssignTagsModal from "../components/CardAssignTagsModal";
import CardDetailContent from "../components/CardDetailContent";
import CardSourceMedia from "../components/CardSourceMedia";
import ChatPanel from "../components/ChatPanel";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import SwipeableCardRow from "../components/SwipeableCardRow";
import TagsPickerModal from "../components/TagsPickerModal";
import TagsTree, { type TagsTreeHandle } from "../components/TagsTree";
import { playHover, playSound } from "../lib/sounds";
import { useSearchModal } from "../lib/SearchModalContext";
import { api, type Card, type CardListItem } from "../lib/api";
import { on } from "../lib/events";

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
  github: {
    Icon: Github,
    color: "text-violet-300",
    fallback: "from-violet-500/25 via-violet-500/5 to-transparent",
    badge: "bg-violet-500/90 text-white",
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
  const statusFilter = params.get("status") ?? "";
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
  // Selected card object — populated by CardDetailContent via onCardLoaded.
  // Used for the source-media panel in the right chat pane (we already
  // have the selectedCardId from the URL, but the panel needs the source
  // type and external_id too).
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  // Player visible by default in the right chat pane — when the card has
  // a video source. Toggle in the pane header lets the user collapse it
  // for a wider chat surface; setting persists during the session.
  const [chatPlayerOpen, setChatPlayerOpen] = useState(true);
  // PDF "maximize" in the right pane is right-pane-scoped, not
  // viewport-fullscreen: the PDF takes the chat's slot instead of
  // 50%, the chat is hidden until the user clicks minimize again.
  const [pdfMaximized, setPdfMaximized] = useState(false);
  // Mobile-only: tags sidebar slides in as a drawer. Closed by default;
  // closes again whenever the URL changes so picking a tag dismisses it.
  const [tagsModalOpen, setTagsModalOpen] = useState(false);

  // Swipe-to-delete with 5 s Undo. Card removed from the visible list
  // immediately, server delete fires only after the Undo window expires.
  const pendingDeletes = useRef(new Map<string, { card: CardListItem; timer: number }>());
  const [deleteToast, setDeleteToast] = useState<{ cardId: string; title: string } | null>(null);
  const toastDismissTimer = useRef<number | null>(null);

  // Tag-assign modal for the row that triggered swipe-right.
  const [assignModal, setAssignModal] = useState<{ cardId: string; tags: string[] } | null>(null);

  const fetchCards = useCallback(async () => {
    try {
      const list = await api.listCards({
        tag: tag ?? undefined,
        untagged: untaggedFilter || undefined,
        source_type: sourceFilter || undefined,
        status: statusFilter || undefined,
        sort,
      });
      setCards(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tag, untaggedFilter, sourceFilter, statusFilter, sort]);

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

  // Polling: only run an interval while at least one card is still
  // ingesting. Keying the effect on a *boolean* (not the array) means
  // the same interval keeps running across fetches instead of being
  // torn down + recreated every 2.5 s, which the previous version did.
  const hasInflight = cards.some(
    (c) => c.status === "queued" || c.status === "processing",
  );
  useEffect(() => {
    if (!hasInflight) return;
    const id = window.setInterval(() => void fetchCards(), 2500);
    return () => window.clearInterval(id);
  }, [hasInflight, fetchCards]);

  // Auto-close the mobile tags drawer whenever the user picks a tag /
  // card / changes filters — the URL params are the source of truth.
  useEffect(() => {
    setTagsModalOpen(false);
  }, [tag, untaggedFilter, selectedCardId, sourceFilter]);

  // Reset right-pane PDF maximize when the selected card changes —
  // the new card may not even be a PDF.
  useEffect(() => {
    setPdfMaximized(false);
  }, [selectedCardId]);

  // Refresh the card list when something elsewhere mutates server state
  // — currently a card-delete from the detail view; later potentially
  // card-creation from the side panel / extension.
  useEffect(() => {
    const off1 = on("card-deleted", () => void fetchCards());
    const off2 = on("card-created", () => void fetchCards());
    return () => {
      off1();
      off2();
    };
  }, [fetchCards]);

  // Refresh whenever the user returns to the tab/window. The eventbus
  // above only catches in-app saves; saves done from the side panel or
  // browser extension don't fire it because they happen on the backend
  // directly. Visibility + focus listeners cover that gap so coming
  // back to the Library tab Just Shows the new card.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchCards();
    };
    const onFocus = () => void fetchCards();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchCards]);

  // Clear the auto-dismiss timer on unmount so we don't setState on a
  // gone component if the user navigates away during the undo window.
  // Pending deletes themselves keep firing — that's intentional, the
  // server commit should still go through.
  useEffect(() => {
    return () => {
      if (toastDismissTimer.current !== null) {
        window.clearTimeout(toastDismissTimer.current);
      }
    };
  }, []);

  const counts = cards.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.status === "completed") acc.completed += 1;
      if (c.status === "failed") acc.failed += 1;
      if (c.status === "processing" || c.status === "queued") acc.inflight += 1;
      if (c.status === "paused") acc.paused += 1;
      return acc;
    },
    { total: 0, completed: 0, failed: 0, inflight: 0, paused: 0 },
  );

  const openCard = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("card", id);
    setParams(next, { replace: false });
  };

  const UNDO_WINDOW_MS = 5000;

  const requestSwipeDelete = (card: CardListItem) => {
    // Already pending — second swipe should be a no-op; the toast is
    // the source of truth until it auto-commits or the user undoes.
    if (pendingDeletes.current.has(card.id)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    const timer = window.setTimeout(() => {
      void api
        .deleteCard(card.id)
        .catch((err) => {
          setError((err as Error).message);
          setCards((prev) => [card, ...prev]);
        })
        .finally(() => {
          pendingDeletes.current.delete(card.id);
          setDeleteToast((cur) => (cur?.cardId === card.id ? null : cur));
        });
    }, UNDO_WINDOW_MS);
    pendingDeletes.current.set(card.id, { card, timer });
    if (toastDismissTimer.current !== null) {
      window.clearTimeout(toastDismissTimer.current);
    }
    setDeleteToast({ cardId: card.id, title: card.title });
    toastDismissTimer.current = window.setTimeout(() => {
      setDeleteToast((cur) => (cur?.cardId === card.id ? null : cur));
    }, UNDO_WINDOW_MS);
  };

  const undoSwipeDelete = (cardId: string) => {
    const entry = pendingDeletes.current.get(cardId);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    pendingDeletes.current.delete(cardId);
    setCards((prev) => {
      if (prev.some((c) => c.id === cardId)) return prev;
      return [entry.card, ...prev];
    });
    setDeleteToast(null);
    if (toastDismissTimer.current !== null) {
      window.clearTimeout(toastDismissTimer.current);
      toastDismissTimer.current = null;
    }
  };

  const openTagPicker = async (cardId: string) => {
    // Fetch tags so the modal opens with the correct checkmarks. The
    // list endpoint omits tags from the payload by design (graph mode
    // would otherwise be expensive), so a per-card request is cheapest.
    try {
      const card = await api.getCard(cardId);
      setAssignModal({ cardId, tags: card.tags ?? [] });
    } catch (err) {
      setError((err as Error).message);
    }
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
        <TagsPickerModal
          open={tagsModalOpen}
          onClose={() => setTagsModalOpen(false)}
        />
        <div className="flex flex-1 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <CardDetailContent
              cardId={selectedCardId}
              onBack={closeCard}
              backStyle="link"
              compact
              hideChatTab={rightPaneOpen}
              onCardLoaded={setSelectedCard}
            />
          </div>
          {rightPaneOpen ? (
            <aside className="pane-enter-right panel-elevated-right hidden lg:flex w-[40%] min-w-[360px] max-w-[640px] flex-col border-l border-ink-800 bg-ink-900/40">
              <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  <MessageSquare className="h-3 w-3" />
                  {t("nav.chat")}
                </div>
                <div className="flex items-center gap-1">
                  {/* Show/hide media toggle — appears for any card type
                      that has something worth rendering alongside the
                      chat: YouTube embed, GitHub repo card + banner. */}
                  {((selectedCard?.source_type === "youtube" && selectedCard.external_id) ||
                    (selectedCard?.source_type === "github" && selectedCard.source_url) ||
                    selectedCard?.source_type === "pdf") && (
                    <button
                      type="button"
                      onClick={() => setChatPlayerOpen((v) => !v)}
                      title={
                        chatPlayerOpen
                          ? t("cardSource.hidePlayer", { defaultValue: "Hide video" }) ?? ""
                          : t("cardSource.showPlayer", { defaultValue: "Show video" }) ?? ""
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
                    >
                      {chatPlayerOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {t(chatPlayerOpen ? "cardSource.hidePlayer" : "cardSource.showPlayer")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleRightPane}
                    title={t("library.rightPane.hide") ?? ""}
                    className="rounded p-1 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
                  >
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-1 min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
                {/* Source-media panel sits above the chat when toggled —
                    splits the available height 50/50 with the conversation
                    so the user can watch and ask side-by-side. YouTube
                    gets the player; GitHub gets the repo card with hero
                    banner. */}
                {chatPlayerOpen &&
                  selectedCard?.source_type === "youtube" &&
                  selectedCard.external_id && (
                    <div className="min-h-0 flex-1">
                      <CardSourceMedia card={selectedCard} fitHeight />
                    </div>
                  )}
                {chatPlayerOpen &&
                  selectedCard?.source_type === "github" &&
                  selectedCard.source_url && (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      <CardSourceMedia card={selectedCard} />
                    </div>
                  )}
                {chatPlayerOpen && selectedCard?.source_type === "pdf" && (
                  <div className="min-h-0 flex-1">
                    <CardSourceMedia
                      card={selectedCard}
                      fitHeight
                      pdfMaximized={pdfMaximized}
                      onPdfMaximizedChange={setPdfMaximized}
                    />
                  </div>
                )}
                <div
                  className={[
                    "min-h-0 flex-1",
                    // Right-pane PDF "maximize" hides the chat instead of
                    // shrinking it — gives the PDF the full pane height
                    // without going viewport-fullscreen.
                    pdfMaximized && selectedCard?.source_type === "pdf"
                      ? "hidden"
                      : "",
                  ].join(" ")}
                >
                  <ChatPanel
                    key={selectedCardId}
                    send={(history) => api.chatCard(selectedCardId, history)}
                    placeholder={t("chat.placeholderCard") ?? ""}
                    emptyHint={t("chat.cardEmpty") ?? ""}
                  />
                </div>
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
      <TagsPickerModal
        open={tagsModalOpen}
        onClose={() => setTagsModalOpen(false)}
      />
      <div className="flex flex-1 min-w-0 flex-col">
      <PageHeader
        icon={Library}
        tone="ink"
        title={t("nav.library")}
        subtitle={
          counts.total > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
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
            </span>
          ) : undefined
        }
        action={
          <button
            type="button"
            onClick={() => {
              playSound("click");
              setModalOpen(true);
            }}
            aria-label={t("library.addContent") ?? "Add content"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-900 shadow-sm transition hover:bg-ink-200 sm:h-auto sm:w-auto sm:gap-2 sm:rounded-md sm:px-3 sm:py-2 sm:text-sm sm:font-medium"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("library.addContent")}</span>
          </button>
        }
      />

      {/* Toolbar strip — search + filters + view toggle */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60">
        <div className="mx-auto max-w-6xl px-3 py-2 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="inline-flex flex-1 min-w-[160px] max-w-md items-center gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-left text-sm text-ink-500 transition hover:border-ink-500 hover:bg-ink-800/80"
            >
              <SearchIcon className="h-3.5 w-3.5 text-ink-500" />
              <span className="flex-1 truncate">{t("library.search")}</span>
              <kbd className="hidden rounded border border-ink-700 bg-ink-900/50 px-1.5 py-0.5 text-[10px] font-mono text-ink-400 sm:inline-block">
                ⌘K
              </kbd>
            </button>

            {/* Tag-filter trigger — opens the full-screen modal on
                mobile, centred card on desktop. We surface this on
                every breakpoint so the desktop user can hop into
                tag navigation without scrolling the sidebar tree.
                The mobile pain point this solves: the previous
                burger-into-side-drawer was too cramped. */}
            <button
              type="button"
              onClick={() => setTagsModalOpen(true)}
              aria-label={t("library.toolbar.tagFilter", {
                defaultValue: "Filter by tag",
              }) ?? "Filter by tag"}
              title={t("library.toolbar.tagFilter", {
                defaultValue: "Filter by tag",
              }) ?? ""}
              className={[
                "inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition",
                tag || untaggedFilter
                  ? "border-ink-100 bg-ink-100 text-ink-900 hover:bg-ink-200"
                  : "border-ink-700 bg-ink-800/60 text-ink-300 hover:border-ink-500 hover:text-ink-100",
              ].join(" ")}
            >
              <Hash className="h-3.5 w-3.5" />
              {(tag || untaggedFilter) && (
                <span className="max-w-[120px] truncate">
                  {untaggedFilter ? t("tags.untagged") : tag}
                </span>
              )}
            </button>

            {/* Quick-clear ×, only when a tag-filter is active.
                Sibling button (not nested inside the trigger) so the
                two hit-zones don't fight for the same tap. */}
            {(tag || untaggedFilter) && (
              <button
                type="button"
                onClick={clearFilters}
                aria-label={t("library.clearFilter") ?? "Clear filter"}
                title={t("library.clearFilter") ?? "Clear filter"}
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <SelectPill
              value={sourceFilter}
              onChange={(v) => setSearchParam("src", v)}
              options={[
                { value: "", label: t("library.toolbar.allSources", { defaultValue: "All sources" }) },
                { value: "youtube", label: "YouTube" },
                { value: "article", label: t("addContent.article") },
                { value: "github", label: "GitHub" },
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

            {/* Read-Later filter — only surfaced when there's at least
                one paused card in the unfiltered set. The button
                doubles as the "process all" trigger when the filter
                is active. */}
            {(statusFilter === "paused" || counts.paused > 0) && (
              <button
                type="button"
                onClick={async () => {
                  if (statusFilter === "paused") {
                    // Already filtered — clicking again triggers
                    // the bulk-process action.
                    try {
                      const r = await api.processAllPausedCards();
                      void r;
                      setSearchParam("status", "");
                      void fetchCards();
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  } else {
                    setSearchParam("status", "paused");
                  }
                }}
                className={[
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition",
                  statusFilter === "paused"
                    ? "bg-ink-100 text-ink-900 ring-ink-100 hover:bg-ink-200"
                    : "bg-ink-800/60 text-ink-300 ring-ink-700 hover:border-ink-600 hover:bg-ink-800/80 hover:text-ink-100",
                ].join(" ")}
                title={
                  statusFilter === "paused"
                    ? (t("library.processAllPaused", {
                        count: counts.paused,
                        defaultValue: `Process all (${counts.paused})`,
                      }) ?? "")
                    : (t("library.readLaterFilter", { defaultValue: "Read Later" }) ?? "")
                }
              >
                {statusFilter === "paused"
                  ? t("library.processAllPaused", {
                      count: counts.paused,
                      defaultValue: `Process all (${counts.paused})`,
                    })
                  : `${t("library.readLaterFilter", { defaultValue: "Read Later" })} (${counts.paused})`}
              </button>
            )}


            {/* View toggle — pinned right. The active-tag chip used to
                live here as a duplicate of what the # trigger now
                surfaces; removed in favour of the single source of
                truth in the trigger button + adjacent X. */}
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
                <SwipeableCardRow
                  key={card.id}
                  onDelete={() => requestSwipeDelete(card)}
                  onTagPick={() => void openTagPicker(card.id)}
                >
                  <CardRow card={card} onClick={() => openCard(card.id)} />
                </SwipeableCardRow>
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

        <CardAssignTagsModal
          open={assignModal !== null}
          cardId={assignModal?.cardId ?? null}
          initialTags={assignModal?.tags ?? []}
          onClose={() => setAssignModal(null)}
          onTagsChanged={(cardId, tags) => {
            // Keep the visible card row in sync (note: CardListItem
            // doesn't carry tags, but downstream filters re-fetch on
            // tag changes anyway).
            setAssignModal((cur) => (cur?.cardId === cardId ? { cardId, tags } : cur));
          }}
        />

        {deleteToast && (
          <div
            className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 bottom-[calc(56px+env(safe-area-inset-bottom)+0.75rem)] md:bottom-6"
          >
            <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/95 px-4 py-3 shadow-2xl backdrop-blur">
              <span className="flex-1 truncate text-sm text-ink-100">
                {t("library.swipeDelete.toast", {
                  defaultValue: "Karte gelöscht",
                })}
                <span className="ml-1 text-ink-400">·</span>
                <span className="ml-1 truncate text-xs text-ink-400">{deleteToast.title}</span>
              </span>
              <button
                type="button"
                onClick={() => undoSwipeDelete(deleteToast.cardId)}
                className="rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition active:bg-ink-200 hover:bg-ink-200"
              >
                {t("common.undo", { defaultValue: "Rückgängig" })}
              </button>
            </div>
          </div>
        )}
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

/**
 * Desktop-only tag sidebar — react-arborist tree with drag-to-reparent
 * and inline create. Mobile users get the TagsPickerModal triggered
 * from the toolbar's Hash button instead, because arborist plus a
 * virtual keyboard plus a 256 px drawer is unusable.
 */
function LibraryTagsSidebar() {
  const { t } = useTranslation();
  const tagsTreeRef = useRef<TagsTreeHandle>(null);
  return (
    <aside className="panel-elevated relative hidden w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 md:flex">
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

