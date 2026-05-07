import {
  Bot,
  FileText,
  Globe,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  X,
  Youtube,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useSearchModal } from "../lib/SearchModalContext";
import { api, type SearchHit } from "../lib/api";

type Mode = "text" | "ai";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
};

export default function GlobalSearchModal() {
  const { open, closeModal } = useSearchModal();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce typing
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  // Run search
  useEffect(() => {
    if (!open) return;
    if (debounced.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const fetcher = mode === "ai" ? api.searchSemantic(debounced, 12) : api.searchKeyword(debounced, 20);
    fetcher
      .then((res) => {
        if (cancelled) return;
        setHits(res);
        setActiveIdx(0);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, mode, open]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActiveIdx(0);
    // Focus input after mount paint
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  const onPick = useCallback(
    (cardId: string) => {
      navigate(`/?card=${cardId}`);
      closeModal();
    },
    [navigate, closeModal],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[activeIdx];
      if (hit) onPick(hit.card_id);
    }
  };

  const placeholder = useMemo(
    () =>
      mode === "ai"
        ? t("search.global.placeholderAi")
        : t("search.global.placeholderText"),
    [mode, t],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh] modal-enter"
      role="dialog"
      aria-modal="true"
      aria-label={t("search.global.title")}
    >
      <button
        type="button"
        onClick={closeModal}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md modal-backdrop-enter"
        aria-label="Close"
      />

      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl modal-card-enter">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-100">{t("search.global.title")}</h2>
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-ink-700 bg-ink-900/40 px-1.5 py-0.5 text-[10px] font-mono text-ink-400">
              ESC
            </kbd>
            <button
              type="button"
              onClick={closeModal}
              className="rounded p-1 text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Input + mode toggle */}
        <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-3">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-1 text-ink-400 transition hover:bg-ink-700/60 hover:text-ink-100"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="flex flex-shrink-0 gap-0.5 rounded-md bg-ink-900/60 p-0.5 ring-1 ring-ink-700">
            <ModeButton active={mode === "text"} onClick={() => setMode("text")} icon={SearchIcon} label={t("search.global.text")} />
            <ModeButton active={mode === "ai"} onClick={() => setMode("ai")} icon={Sparkles} label={t("search.global.ai")} />
          </div>
        </div>

        {/* Results */}
        <div className="flex max-h-[55vh] flex-col overflow-y-auto">
          {!debounced && (
            <EmptyHint />
          )}
          {debounced && busy && hits.length === 0 && (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}
          {debounced && !busy && hits.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-ink-400">
              {t("search.global.empty")}
            </p>
          )}
          {hits.length > 0 && (
            <ul className="divide-y divide-ink-700/60">
              {hits.map((h, i) => (
                <li key={`${h.card_id}-${i}`}>
                  <ResultRow
                    hit={h}
                    active={i === activeIdx}
                    onClick={() => onPick(h.card_id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer with hint */}
        <div className="flex items-center gap-3 border-t border-ink-700 bg-ink-900/40 px-5 py-2 text-[10px] text-ink-400">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-ink-700 px-1 font-mono">↑↓</kbd>
            {t("search.global.hintNav")}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-ink-700 px-1 font-mono">↵</kbd>
            {t("search.global.hintOpen")}
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <kbd className="rounded border border-ink-700 px-1 font-mono">⌘K</kbd>
            {t("search.global.hintToggle")}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof SearchIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition",
        active ? "bg-ink-100 text-ink-900" : "text-ink-300 hover:text-ink-100",
      ].join(" ")}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function ResultRow({
  hit,
  active,
  onClick,
}: {
  hit: SearchHit;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = SOURCE_ICONS[hit.source_type] ?? Bot;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-start gap-3 px-5 py-3 text-left transition",
        active ? "bg-ink-700/60" : "hover:bg-ink-700/30",
      ].join(" ")}
    >
      {hit.thumbnail_url ? (
        <img src={hit.thumbnail_url} alt="" className="mt-0.5 h-10 w-14 flex-shrink-0 rounded object-cover" />
      ) : (
        <div className="mt-0.5 flex h-10 w-14 flex-shrink-0 items-center justify-center rounded bg-ink-700 text-ink-300">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
          <Icon className="h-3 w-3" />
          {hit.source_type}
        </p>
        <p className="truncate text-sm font-medium text-ink-100">{hit.title}</p>
        {hit.snippet && (
          <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{hit.snippet}</p>
        )}
      </div>
    </button>
  );
}

function EmptyHint() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-700/40 ring-1 ring-ink-700">
        <SearchIcon className="h-4 w-4 text-ink-300" />
      </div>
      <p className="text-sm text-ink-300">{t("search.global.startTyping")}</p>
      <p className="max-w-xs text-[11px] leading-relaxed text-ink-500">
        {t("search.global.modeHint")}
      </p>
    </div>
  );
}
