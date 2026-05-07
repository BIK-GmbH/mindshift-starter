import { Loader2, Search as SearchIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type SearchHit } from "../lib/api";

type Mode = "keyword" | "semantic";

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
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t("nav.search")}</h1>
      <p className="mb-6 text-sm text-ink-300">{t("search.subtitle")}</p>

      <form onSubmit={submit} className="mb-6 space-y-3">
        <div className="flex gap-1 rounded-md bg-ink-700 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("semantic")}
            className={[
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 transition",
              mode === "semantic" ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-600",
            ].join(" ")}
          >
            <Sparkles className="h-3 w-3" />
            {t("search.semantic")}
          </button>
          <button
            type="button"
            onClick={() => setMode("keyword")}
            className={[
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 transition",
              mode === "keyword" ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-600",
            ].join(" ")}
          >
            <SearchIcon className="h-3 w-3" />
            {t("search.keyword")}
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "semantic" ? t("search.placeholderSemantic") ?? "" : t("search.placeholderKeyword") ?? ""
            }
            className="flex-1 rounded border border-ink-600 bg-ink-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 hover:bg-ink-200 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchIcon className="h-3.5 w-3.5" />}
            {t("search.run")}
          </button>
        </div>
      </form>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {hits === null ? (
        <p className="text-xs text-ink-400">{t("search.hint")}</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-ink-300">{t("search.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={`${hit.card_id}-${hit.chunk_index ?? "k"}`}>
              <button
                type="button"
                onClick={() => navigate(`/cards/${hit.card_id}`)}
                className="flex w-full gap-3 rounded-lg border border-ink-700 bg-ink-800 p-3 text-left transition hover:border-ink-500"
              >
                {hit.thumbnail_url ? (
                  <img
                    src={hit.thumbnail_url}
                    alt=""
                    className="h-16 w-24 flex-shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded bg-ink-700 text-[10px] uppercase text-ink-400">
                    {hit.source_type}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium">{hit.title}</h3>
                    {mode === "semantic" && (
                      <span className="ml-auto flex-shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300">
                        {(hit.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-3 text-xs text-ink-300">{hit.snippet}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
