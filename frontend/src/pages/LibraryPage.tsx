import { Hash, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import AddContentModal from "../components/AddYouTubeModal";
import StatusBadge from "../components/StatusBadge";
import { api, type CardListItem } from "../lib/api";

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

  return (
    <div className="mx-auto max-w-5xl p-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("nav.library")}</h1>
          <p className="text-sm text-ink-300">{t("app.tagline")}</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-200"
        >
          <Plus className="h-4 w-4" />
          {t("library.addContent")}
        </button>
      </header>

      <form onSubmit={onSearchSubmit} className="mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("library.search") ?? ""}
          className="w-full rounded border border-ink-600 bg-ink-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
        />
      </form>

      {tag && (
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-ink-700 px-2 py-1 text-xs text-ink-100">
            <Hash className="h-3 w-3" />
            {tag}
          </span>
          <button
            type="button"
            onClick={clearTag}
            className="inline-flex items-center gap-1 text-xs text-ink-300 hover:text-ink-100"
          >
            <X className="h-3 w-3" />
            {t("library.clearFilter")}
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-300">{t("common.loading")}</p>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-600 p-12 text-center">
          <h2 className="text-lg font-medium">{t("library.empty.title")}</h2>
          <p className="mt-2 text-sm text-ink-300">{t("library.empty.body")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => navigate(`/cards/${card.id}`)}
              className="flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-800 text-left transition hover:border-ink-500"
            >
              {card.thumbnail_url ? (
                <img
                  src={card.thumbnail_url}
                  alt=""
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-video w-full bg-ink-700" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-ink-400">
                    {card.source_type}
                  </span>
                  <StatusBadge status={card.status} />
                </div>
                <h3 className="line-clamp-2 text-sm font-medium leading-snug">{card.title}</h3>
                {card.concise_summary_md && (
                  <p className="line-clamp-3 text-xs text-ink-300">{card.concise_summary_md}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <AddContentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void fetchCards(search.trim() || undefined)}
      />
    </div>
  );
}
