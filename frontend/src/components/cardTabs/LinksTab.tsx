/* Extracted-links tab.
 *
 * Lists every URL we found in the card's source — for YouTube cards
 * that's the description plus the spoken transcript; future source
 * types (article, PDF) will plug in via the same context labels.
 *
 * The endpoint backfills lazily, so on first open of a pre-existing
 * card the response can take ~50–200 ms while the regex runs over
 * the transcript. We show a small loader for that window.
 */

import { ExternalLink, FileText, Github, Link as LinkIcon, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type AiResource, type ExtractedLink } from "../../lib/api";

interface Props {
  cardId: string;
}

export default function LinksTab({ cardId }: Props) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<ExtractedLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // AI-resources are an independent fetch — we kick it off in parallel
  // and let it stream in. Discovered links arrive in a few hundred
  // ms; AI resources take 2–4 s because of the LLM + 3 web searches.
  const [aiResources, setAiResources] = useState<AiResource[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadAi = (refresh = false) => {
    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    if (refresh) setAiResources(null);
    void (async () => {
      try {
        const res = await api.getCardAiResources(cardId, refresh);
        if (!cancelled) setAiResources(res.resources);
      } catch (err) {
        if (!cancelled) setAiError((err as Error).message);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLinks(null);
    setAiResources(null);
    setAiError(null);
    void (async () => {
      try {
        const res = await api.getCardLinks(cardId);
        if (!cancelled) setLinks(res.links);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Fire-and-forget AI discovery in parallel.
    const cancel = loadAi(false);
    return () => {
      cancelled = true;
      cancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const grouped = useMemo(() => {
    if (!links) return { description: [], transcript: [], other: [] };
    const description: ExtractedLink[] = [];
    const transcript: ExtractedLink[] = [];
    const other: ExtractedLink[] = [];
    for (const l of links) {
      if (l.context === "description") description.push(l);
      else if (l.context === "transcript") transcript.push(l);
      else other.push(l);
    }
    return { description, transcript, other };
  }, [links]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("links.loading", { defaultValue: "Suche Links im Inhalt…" })}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }

  const hasExtracted = !!links && links.length > 0;

  return (
    <div className="space-y-6">
      <AiResourcesSection
        loading={aiLoading}
        error={aiError}
        items={aiResources}
        onRefresh={() => loadAi(true)}
      />

      {hasExtracted ? (
        <div className="space-y-4">
          <p className="text-xs text-ink-500">
            {t("links.lead", {
              count: links!.length,
              defaultValue:
                "{{count}} Links — gruppiert nach Quelle. Jeder öffnet sich in einem neuen Tab.",
            })}
          </p>
          {grouped.description.length > 0 && (
            <LinkGroup
              title={t("links.section.description", {
                defaultValue: "Aus der Beschreibung",
              })}
              items={grouped.description}
            />
          )}
          {grouped.transcript.length > 0 && (
            <LinkGroup
              title={t("links.section.transcript", { defaultValue: "Im Video erwähnt" })}
              items={grouped.transcript}
            />
          )}
          {grouped.other.length > 0 && (
            <LinkGroup
              title={t("links.section.other", { defaultValue: "Weitere" })}
              items={grouped.other}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-5 py-6 text-sm text-ink-400">
          <LinkIcon className="h-5 w-5 text-ink-500" />
          <p className="font-medium text-ink-300">
            {t("links.emptyTitle", { defaultValue: "Keine Links im Inhalt" })}
          </p>
          <p className="text-xs text-ink-500">
            {t("links.emptyBody", {
              defaultValue:
                "Im Transkript und in der Beschreibung dieses Inhalts sind keine URLs aufgetaucht.",
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function AiResourcesSection({
  loading,
  error,
  items,
  onRefresh,
}: {
  loading: boolean;
  error: string | null;
  items: AiResource[] | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
          <Sparkles className="h-3 w-3 text-violet-300" />
          {t("links.aiSection", { defaultValue: "KI-Vorschläge zum Thema" })}
          {items && items.length > 0 && (
            <span className="font-normal text-ink-600">· {items.length}</span>
          )}
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-400 transition hover:text-ink-100 disabled:opacity-50"
          aria-label={t("links.aiRefresh", { defaultValue: "Neu generieren" }) ?? ""}
          title={t("links.aiRefresh", { defaultValue: "Neu generieren" }) ?? ""}
        >
          <RefreshCw className={["h-3 w-3", loading ? "animate-spin" : ""].join(" ")} />
        </button>
      </header>

      {loading && !items && (
        <div className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-4 text-xs text-ink-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("links.aiLoading", { defaultValue: "Recherchiere Repos, Docs und Web-Quellen…" })}
        </div>
      )}

      {!loading && error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {!loading && items && items.length === 0 && (
        <p className="rounded-md border border-dashed border-ink-800 bg-ink-900/40 px-4 py-3 text-xs text-ink-500">
          {t("links.aiEmpty", {
            defaultValue: "Keine zusätzlichen Quellen gefunden — vielleicht ist das Thema sehr spezifisch oder die Web-Suche ist ausgeknipst.",
          })}
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40">
          {items.map((r) => (
            <li key={r.url}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 px-4 py-2.5 transition hover:bg-ink-800/50"
              >
                <KindBadge kind={r.kind} domain={r.domain} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-100 group-hover:text-white">
                    {r.title}
                  </span>
                  <span className="block truncate text-[10px] text-ink-500">
                    {r.domain}
                    {r.age ? ` · ${r.age}` : ""}
                  </span>
                  {r.snippet && (
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-snug text-ink-400">
                      {r.snippet}
                    </span>
                  )}
                </span>
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-ink-500 transition group-hover:text-ink-100" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KindBadge({ kind, domain }: { kind: string; domain: string }) {
  if (kind === "github") {
    return (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-ink-200 ring-1 ring-ink-700">
        <Github className="h-4 w-4" />
      </span>
    );
  }
  if (kind === "doc") {
    return (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30">
        <FileText className="h-4 w-4" />
      </span>
    );
  }
  // Fallback: favicon to match the extracted-links rows visually.
  const src = domain
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
    : null;
  return src ? (
    <img src={src} alt="" loading="lazy" className="h-8 w-8 flex-shrink-0 rounded bg-ink-800 object-contain p-1" />
  ) : (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-ink-500">
      <LinkIcon className="h-4 w-4" />
    </span>
  );
}

function LinkGroup({ title, items }: { title: string; items: ExtractedLink[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        {title} <span className="font-normal text-ink-600">· {items.length}</span>
      </h3>
      <ul className="divide-y divide-ink-800 overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40">
        {items.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-ink-800/50"
            >
              <Favicon domain={l.domain} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink-100">
                  {l.domain || l.url}
                </span>
                <span className="block truncate text-[10px] text-ink-500">{l.url}</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-ink-500 transition group-hover:text-ink-100" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Favicon({ domain }: { domain: string }) {
  // Google's favicon endpoint — cached, no auth required. Falls back
  // to a generic icon if the domain is missing or the request fails.
  const src = domain
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
    : null;
  if (!src) {
    return (
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-ink-500">
        <LinkIcon className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-7 w-7 flex-shrink-0 rounded bg-ink-800 object-contain p-1"
    />
  );
}
