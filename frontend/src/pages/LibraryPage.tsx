import { FileText, Globe, Hash, Plus, Search as SearchIcon, X, Youtube } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import AddContentModal from "../components/AddYouTubeModal";
import StatusBadge from "../components/StatusBadge";
import { api, type CardListItem } from "../lib/api";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
};

export default function LibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag");
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pollTimerRef = useRef<number | null>(null);

  const fetchCards = useCallback(
    async (q?: string) => {
      try {
        const list = await api.listCards({ q, tag: tag ?? undefined });
        setCards(list);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [tag],
  );

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  const clearTag = () => {
    const next = new URLSearchParams(params);
    next.delete("tag");
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
    pollTimerRef.current = window.setInterval(() => void fetchCards(search || undefined), 2500);
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [cards, fetchCards, search]);

  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchCards(search.trim() || undefined);
  };

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

  return (
    <div className="flex h-full flex-col">
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
              className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 shadow-sm transition hover:bg-white"
            >
              <Plus className="h-4 w-4" />
              {t("library.addContent")}
            </button>
          </div>

          <form onSubmit={onSearchSubmit} className="mt-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("library.search") ?? ""}
                className="w-full rounded-lg border border-ink-700 bg-ink-800/60 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
              />
            </div>
          </form>

          {tag && (
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-700/70 px-2.5 py-0.5 text-[11px] font-medium text-ink-100 ring-1 ring-ink-600">
                <Hash className="h-3 w-3 text-ink-300" />
                {tag}
              </span>
              <button
                type="button"
                onClick={clearTag}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X className="h-3 w-3" />
                {t("library.clearFilter")}
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
                  onClick={() => navigate(`/cards/${card.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AddContentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void fetchCards(search.trim() || undefined)}
      />
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function CardTile({ card, onClick }: { card: CardListItem; onClick: () => void }) {
  const SourceIcon = SOURCE_ICONS[card.source_type] ?? FileText;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/40 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-ink-600 hover:shadow-lg hover:shadow-black/30"
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
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-white"
      >
        <Plus className="h-4 w-4" />
        {t("library.addContent")}
      </button>
    </div>
  );
}
