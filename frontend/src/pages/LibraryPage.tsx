import {
  FileText,
  Globe,
  Hash,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search as SearchIcon,
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
import TagsTree from "../components/TagsTree";
import { useSearchModal } from "../lib/SearchModalContext";
import { api, type CardListItem } from "../lib/api";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
};

const RIGHT_PANE_KEY = "mindshift.libraryRightPane";

export default function LibraryPage() {
  const { t } = useTranslation();
  const { openModal: openSearch } = useSearchModal();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag");
  const untaggedFilter = params.get("untagged") === "1";
  const selectedCardId = params.get("card");
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
      });
      setCards(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tag, untaggedFilter]);

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete("tag");
    next.delete("untagged");
    setParams(next);
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
            <aside className="flex w-[40%] min-w-[360px] max-w-[640px] flex-col border-l border-ink-800 bg-ink-900/40">
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
      {/* Sticky header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-8 pb-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
                {t("nav.library")}
              </h1>
              <p className="mt-1 text-sm text-ink-400">{t("app.tagline")}</p>
              {counts.total > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                  <span>
                    <span className="font-medium tabular-nums text-ink-200">{counts.total}</span>{" "}
                    {t("library.stats.cards")}
                  </span>
                  {counts.completed > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {counts.completed} {t("library.stats.completed")}
                    </span>
                  )}
                  {counts.inflight > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      {counts.inflight} {t("library.stats.processing")}
                    </span>
                  )}
                  {counts.failed > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      {counts.failed} {t("library.stats.failed")}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 shadow-sm transition hover:bg-ink-200"
            >
              <Plus className="h-4 w-4" />
              {t("library.addContent")}
            </button>
          </div>

          <button
            type="button"
            onClick={openSearch}
            className="mt-4 flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-left text-sm text-ink-500 transition hover:border-ink-500 hover:bg-ink-800/80"
          >
            <SearchIcon className="h-4 w-4 text-ink-500" />
            <span className="flex-1">{t("library.search")}</span>
            <kbd className="hidden rounded border border-ink-700 bg-ink-900/50 px-1.5 py-0.5 text-[10px] font-mono text-ink-400 sm:inline-block">
              ⌘K
            </kbd>
          </button>

          {(tag || untaggedFilter) && (
            <div className="mt-3 flex items-center gap-2 text-[11px]">
              <span className="text-ink-500">{t("library.filteredBy")}:</span>
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
                className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X className="h-3 w-3" />
                {t("library.clearAll")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
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
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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

function LibraryTagsSidebar() {
  const { t } = useTranslation();
  return (
    <aside className="flex w-60 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
          {t("nav.tags")}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        <TagsTree />
      </div>
    </aside>
  );
}

function CardTile({ card, onClick }: { card: CardListItem; onClick: () => void }) {
  const SourceIcon = SOURCE_ICONS[card.source_type] ?? FileText;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-hover group relative flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/40 text-left shadow-sm hover:border-ink-600"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-ink-800">
        {card.thumbnail_url ? (
          <img
            src={card.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-800 to-ink-900">
            <SourceIcon className="h-8 w-8 text-ink-600" />
          </div>
        )}
        <div className="absolute right-2 top-2">
          <StatusBadge status={card.status} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink-900/60 to-transparent" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
          <SourceIcon className="h-3 w-3" />
          {card.source_type}
        </div>
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
