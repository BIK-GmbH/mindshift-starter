import { FileText, Globe, Loader2, Search as SearchIcon, Sparkles, Youtube } from "lucide-react";
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type SearchHit } from "../lib/api";

type Mode = "keyword" | "semantic";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
};

export default function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("semantic");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "semantic" ? await api.searchSemantic(q) : await api.searchKeyword(q);
      setHits(result);
    } catch (err) {
      setError((err as Error).message || t("common.error"));
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-8 pb-4 pt-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
            {t("nav.search")}
          </h1>
          <p className="mt-1 text-sm text-ink-400">{t("search.subtitle")}</p>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="flex gap-1 rounded-lg border border-ink-700 bg-ink-800/50 p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("semantic")}
                className={[
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition",
                  mode === "semantic"
                    ? "bg-ink-100 text-ink-900 shadow-sm"
                    : "text-ink-300 hover:text-ink-100",
                ].join(" ")}
              >
                <Sparkles className="h-3 w-3" />
                {t("search.semantic")}
              </button>
              <button
                type="button"
                onClick={() => setMode("keyword")}
                className={[
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition",
                  mode === "keyword"
                    ? "bg-ink-100 text-ink-900 shadow-sm"
                    : "text-ink-300 hover:text-ink-100",
                ].join(" ")}
              >
                <SearchIcon className="h-3 w-3" />
                {t("search.keyword")}
              </button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    mode === "semantic"
                      ? t("search.placeholderSemantic") ?? ""
                      : t("search.placeholderKeyword") ?? ""
                  }
                  className="w-full rounded-lg border border-ink-700 bg-ink-800/60 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !query.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-white disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SearchIcon className="h-3.5 w-3.5" />
                )}
                {t("search.run")}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-12 pt-6">
          {error && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {hits === null ? (
            <SuggestionPanel mode={mode} onPick={(q) => setQuery(q)} />
          ) : hits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-700 bg-ink-800/30 p-12 text-center">
              <SearchIcon className="mx-auto mb-3 h-6 w-6 text-ink-500" />
              <p className="text-sm text-ink-300">{t("search.empty")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {hits.map((hit) => (
                <SearchHitRow
                  key={`${hit.card_id}-${hit.chunk_index ?? "k"}`}
                  hit={hit}
                  mode={mode}
                  onOpen={() => navigate(`/cards/${hit.card_id}`)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchHitRow({
  hit,
  mode,
  onOpen,
}: {
  hit: SearchHit;
  mode: Mode;
  onOpen: () => void;
}) {
  const SourceIcon = SOURCE_ICONS[hit.source_type] ?? FileText;
  const scorePct = Math.round(hit.score * 100);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full gap-3 rounded-xl border border-ink-800 bg-ink-800/40 p-3 text-left transition hover:-translate-y-0.5 hover:border-ink-600 hover:bg-ink-800/70"
      >
        {hit.thumbnail_url ? (
          <img
            src={hit.thumbnail_url}
            alt=""
            className="h-16 w-24 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
            loading="lazy"
          />
        ) : (
          <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-ink-800 to-ink-900 ring-1 ring-ink-700">
            <SourceIcon className="h-5 w-5 text-ink-500" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
              <SourceIcon className="h-3 w-3" />
              {hit.source_type}
            </div>
            {mode === "semantic" && (
              <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                <span className="tabular-nums font-medium">{scorePct}%</span>
                <span className="block h-1 w-12 overflow-hidden rounded-full bg-ink-800">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-ink-400 to-ink-100"
                    style={{ width: `${scorePct}%` }}
                  />
                </span>
              </div>
            )}
          </div>
          <h3 className="truncate text-sm font-medium text-ink-100">{hit.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-400">
            {hit.snippet}
          </p>
        </div>
      </button>
    </li>
  );
}

function SuggestionPanel({ mode, onPick }: { mode: Mode; onPick: (q: string) => void }) {
  const { t } = useTranslation();
  const semanticPrompts = [
    "How do neural networks actually learn?",
    "What is the difference between RNN and Transformer?",
    "Why does spaced repetition work for memory?",
    "Wie funktionieren Aufmerksamkeitsmechanismen?",
  ];
  const keywordPrompts = ["transformer", "gradient", "memory", "GPT"];
  const items = mode === "semantic" ? semanticPrompts : keywordPrompts;

  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-800/30 p-6">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-500">
        {t("search.tryThese")}
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-full bg-ink-800 px-3 py-1.5 text-xs text-ink-200 ring-1 ring-ink-700 transition hover:bg-ink-700 hover:text-ink-100"
          >
            {q}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-500">{t("search.hint")}</p>
    </div>
  );
}
