import { Check, Loader2, Plus, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type CardListItem } from "../lib/api";

interface Props {
  open: boolean;
  /** Card IDs already in the parent collection — they get a check mark
   *  and aren't selectable (callers can use this to dedupe). */
  alreadyIn: Set<string>;
  onClose: () => void;
  /** Called once with the full ordered list of newly-picked card IDs.
   *  Parent owns the persistence call. */
  onPick: (cardIds: string[]) => void | Promise<void>;
}

/**
 * Generic "pick cards from library" modal. Powers the path editor's
 * "Add cards" button and is intentionally unaware of paths so it can be
 * dropped into other features later (collections, share-bundles, …).
 */
export default function CardPickerModal({ open, alreadyIn, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CardListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setQuery("");
    setLoading(true);
    void (async () => {
      try {
        const list = await api.listCards({ sort: "newest" });
        setCards(list);
      } finally {
        setLoading(false);
      }
    })();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.title.toLowerCase().includes(q));
  }, [cards, query]);

  const togglePick = (id: string) => {
    if (alreadyIn.has(id)) return;
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!picked.length) return;
    setSubmitting(true);
    try {
      await onPick(picked);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex bg-black/60 sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="
          panel-elevated relative z-10 flex w-full flex-col overflow-hidden bg-ink-900
          h-full sm:h-auto sm:max-h-[80vh]
          sm:w-full sm:max-w-2xl sm:rounded-xl sm:border sm:border-ink-700
        "
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-ink-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="-ml-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-ink-300 transition active:bg-ink-800 hover:bg-ink-800 hover:text-ink-100"
              title={t("common.cancel") ?? ""}
              aria-label={t("common.cancel") ?? "Cancel"}
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="truncate text-sm font-semibold text-ink-100">
              {t("cardPicker.title", { defaultValue: "Pick cards" })}
            </h2>
          </div>
          {/* Primary action in the header — always visible on mobile
              regardless of scroll position or soft-keyboard. The footer
              keeps the same button for desktop / sm+ users. */}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!picked.length || submitting}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition active:bg-ink-200 hover:bg-ink-200 disabled:opacity-40"
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            {picked.length > 0
              ? t("cardPicker.addN", {
                  count: picked.length,
                  defaultValue: `Hinzufügen (${picked.length})`,
                })
              : t("cardPicker.add", { defaultValue: "Hinzufügen" })}
          </button>
        </header>

        <div className="border-b border-ink-800 p-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("cardPicker.searchPlaceholder", { defaultValue: "Search by title…" }) ?? ""}
              className="w-full rounded-md border border-ink-700 bg-ink-800/60 py-1.5 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-ink-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-400">
              {t("cardPicker.noResults", { defaultValue: "No matching cards." })}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((card) => {
                const inAlready = alreadyIn.has(card.id);
                const isPicked = picked.includes(card.id);
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      disabled={inAlready}
                      onClick={() => togglePick(card.id)}
                      className={[
                        "flex w-full items-center gap-3 rounded-md border px-2 py-2 text-left transition",
                        inAlready
                          ? "border-ink-800 bg-ink-800/30 opacity-50"
                          : isPicked
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-ink-800 hover:border-ink-700 hover:bg-ink-800/40",
                      ].join(" ")}
                    >
                      {card.thumbnail_url ? (
                        <img
                          src={card.thumbnail_url}
                          alt=""
                          className="h-9 w-14 flex-shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-9 w-14 flex-shrink-0 rounded bg-ink-800" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-100">{card.title}</p>
                        <p className="text-[10px] uppercase tracking-wider text-ink-500">
                          {card.source_type}
                        </p>
                      </div>
                      {inAlready ? (
                        <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-ink-500">
                          {t("cardPicker.alreadyIn", { defaultValue: "in path" })}
                        </span>
                      ) : isPicked ? (
                        <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer hint — desktop sm+ shows the full secondary buttons
            row; mobile relies on the always-visible primary button in
            the header (the bottom-nav would otherwise overlap a footer
            here). */}
        <footer
          className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-ink-800 px-4 py-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <p className="truncate text-xs text-ink-400">
            {picked.length > 0
              ? t("cardPicker.selected", {
                  count: picked.length,
                  defaultValue: `${picked.length} selected`,
                })
              : t("cardPicker.selectHint", { defaultValue: "Tap a card to select it." })}
          </p>
          <div className="hidden gap-2 sm:flex">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!picked.length || submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("cardPicker.add", { defaultValue: "Add to path" })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
