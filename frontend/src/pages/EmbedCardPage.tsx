import { ExternalLink, FileText, Loader2, Moon, StickyNote, Sun } from "lucide-react";
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import CardLanguagePicker from "../components/CardLanguagePicker";
import IngestionSkeleton from "../components/IngestionSkeleton";
import MarkdownView from "../components/MarkdownView";
import { api, tokenStorage, type Card, type CardTranslationOut, type TranscriptOut } from "../lib/api";

/**
 * Side-panel-local theme state, independent of the main app's
 * `mindshift.theme`. Reasons:
 *  1. The user wants the panel to follow the browser's system theme
 *     out of the box even if they explicitly picked dark in the
 *     main library.
 *  2. The iframe shares localStorage with the main tab. If we used
 *     the same key, toggling the panel would also flip the main app
 *     and vice-versa — a surprise either way.
 */
const EMBED_THEME_KEY = "mindshift.embedTheme";

function readEmbedTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(EMBED_THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

type EmbedTab = "summary" | "transcript" | "notes";
type SummaryDepth = "concise" | "detailed";

const TAB_ICONS: Record<EmbedTab, FC<{ className?: string }>> = {
  summary: FileText,
  transcript: FileText,
  notes: StickyNote,
};

/**
 * Side-panel embed view for the browser extension.
 *
 * Recall-inspired layout:
 *
 *  ┌────────────────────────────────────────┐
 *  │ [Open ↗]  [Copy]              [⚙]      │  always-on-top mini bar
 *  ├────────────────────────────────────────┤
 *  │  ┌──────────────────────────────────┐  │
 *  │  │     hero image (scrolls away)    │  │
 *  │  │  Title overlaid + source pill    │  │
 *  │  └──────────────────────────────────┘  │
 *  │  #tag #tag #tag                         │
 *  ├ — — — — — — — — — — — — — — — — — — —  ┤  sticky once it hits top
 *  │  Summary   Transcript   Notes   Chat    │
 *  ├────────────────────────────────────────┤
 *  │                                          │
 *  │  Tab content (scrollable)               │
 *  │                                          │
 *  └────────────────────────────────────────┘
 *
 * Loaded inside an iframe from the extension; shares localStorage with
 * the main Mindshift tab so the JWT carries over automatically.
 */
export default function EmbedCardPage() {
  const { cardId = "" } = useParams<{ cardId: string }>();
  const { t } = useTranslation();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EmbedTab>("summary");
  const [summaryDepth, setSummaryDepth] = useState<SummaryDepth>("concise");
  const [transcript, setTranscript] = useState<TranscriptOut | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedTheme, setEmbedTheme] = useState<"dark" | "light">(readEmbedTheme);
  const [activeTranslation, setActiveTranslation] = useState<CardTranslationOut | null>(null);

  // Apply the embed theme to the document root. We're effectively
  // racing the global ThemeProvider for the same classList, but we
  // load second on `/embed/cards/*` and the user's system or saved
  // preference for the panel wins.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", embedTheme === "light");
    root.classList.toggle("dark", embedTheme === "dark");
  }, [embedTheme]);

  // Follow OS toggle until the user makes an explicit panel choice.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => {
      const saved = window.localStorage.getItem(EMBED_THEME_KEY);
      if (saved !== "dark" && saved !== "light") {
        setEmbedTheme(e.matches ? "light" : "dark");
      }
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const toggleEmbedTheme = () => {
    setEmbedTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(EMBED_THEME_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    const tok = tokenStorage.get();
    setHasToken(!!tok);
    if (!tok) return;
    void (async () => {
      try {
        const data = await api.getCard(cardId);
        setCard(data);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [cardId]);

  // Poll while the card is still being processed so the side panel
  // catches up to "completed" without the user having to refresh.
  // Cheap GET, single in-flight at a time, stops once status changes.
  useEffect(() => {
    if (!card) return;
    if (card.status === "completed" || card.status === "failed") return;
    const id = window.setInterval(async () => {
      try {
        const fresh = await api.getCard(cardId);
        setCard(fresh);
      } catch {
        /* swallow — next tick will retry */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [card?.status, cardId, card]);

  // Lazy-load transcript only when the user opens that tab.
  useEffect(() => {
    if (tab !== "transcript" || transcript !== null || !card) return;
    setTranscriptLoading(true);
    void (async () => {
      try {
        const data = await api.getTranscript(cardId);
        setTranscript(data);
      } catch {
        setTranscript({
          card_id: cardId,
          language: null,
          provider: null,
          text: "",
          segments: null,
        });
      } finally {
        setTranscriptLoading(false);
      }
    })();
  }, [tab, cardId, transcript, card]);

  const webOrigin = window.location.origin;
  const tabs = useMemo<EmbedTab[]>(() => {
    const list: EmbedTab[] = ["summary"];
    // Only show transcript for sources that actually have one.
    if (
      card?.source_type === "youtube" ||
      card?.source_type === "article" ||
      card?.source_type === "pdf" ||
      card?.source_type === "github"
    ) {
      list.push("transcript");
    }
    list.push("notes");
    return list;
  }, [card?.source_type]);

  if (hasToken === null || (hasToken && !card && !error)) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }
  if (!hasToken) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 px-4 text-center text-xs text-ink-400">
        Open Mindshift in another tab and sign in — the side panel
        shares your session automatically.
      </div>
    );
  }
  if (error || !card) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 px-4 text-center text-xs text-red-300">
        {error}
      </div>
    );
  }

  const cardLink = `${webOrigin}/?card=${card.id}`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-900 text-ink-100">
      {/* Always-on-top mini bar */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900/95 px-2 py-1.5 backdrop-blur">
        <a
          href={cardLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-ink-800/80 px-2 py-1 text-[11px] font-medium text-ink-100 transition hover:bg-ink-800"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
        <button
          type="button"
          title={copied ? "Copied" : "Copy link"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cardLink);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard API can be denied in iframes — silently ignore */
            }
          }}
          className={[
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
            copied ? "bg-emerald-500/15 text-emerald-300" : "bg-ink-800/80 text-ink-300 hover:bg-ink-800 hover:text-ink-100",
          ].join(" ")}
        >
          {copied ? "✓" : "🔗"}
        </button>
        {(card.status === "queued" || card.status === "processing") && (
          <span
            title={
              card.status === "queued"
                ? t("ingest.queued", { defaultValue: "Queued for processing…" }) ?? ""
                : t("ingest.processing", { defaultValue: "Generating your card…" }) ?? ""
            }
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-500/15 ring-1 ring-fuchsia-500/40"
          >
            <Loader2 className="h-3 w-3 animate-spin text-fuchsia-300" />
          </span>
        )}
        <span className="ml-auto rounded-full bg-ink-800/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-400">
          {card.source_type}
        </span>
        {card.status === "completed" && (
          <CardLanguagePicker cardId={card.id} onActive={setActiveTranslation} />
        )}
        <button
          type="button"
          onClick={toggleEmbedTheme}
          title={embedTheme === "dark" ? "Light mode" : "Dark mode"}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
        >
          {embedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* While the card is still being processed, replace the regular
          tabbed body with the animated skeleton. Polling above flips
          us back to the real layout once status flips to completed. */}
      {(card.status === "queued" || card.status === "processing") ? (
        <div className="flex-1 overflow-y-auto">
          <IngestionSkeleton
            status={card.status}
            thumbnailUrl={card.thumbnail_url}
            title={card.title}
            variant="compact"
          />
        </div>
      ) : (
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
        {/* Hero — scrolls away */}
        {card.thumbnail_url ? (
          <div className="relative aspect-video w-full flex-shrink-0 bg-ink-800">
            <img
              src={card.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
            />
            {/* Gradient + title overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
            <h1 className="absolute bottom-0 left-0 right-0 p-3 text-base font-semibold leading-snug text-ink-100">
              {activeTranslation?.title ?? card.title}
            </h1>
          </div>
        ) : (
          <div className="flex-shrink-0 border-b border-ink-800 px-3 py-3">
            <h1 className="text-base font-semibold leading-snug text-ink-100">
              {activeTranslation?.title ?? card.title}
            </h1>
          </div>
        )}

        {/* Tags row — also scrolls */}
        {card.tags && card.tags.length > 0 && (
          <div className="flex flex-shrink-0 flex-wrap gap-1 px-3 py-2">
            {card.tags.map((tg) => (
              <span
                key={tg}
                className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
              >
                #{tg}
              </span>
            ))}
          </div>
        )}

        {/* Sticky tab strip */}
        <nav className="sticky top-0 z-10 flex flex-shrink-0 gap-0.5 border-b border-ink-800 bg-ink-900/95 px-2 backdrop-blur">
          {tabs.map((id) => {
            const Icon = TAB_ICONS[id];
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  "relative inline-flex items-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-ink-100" : "text-ink-400 hover:text-ink-200",
                ].join(" ")}
              >
                <Icon className="h-3 w-3" />
                <span>
                  {t(`embed.tab.${id}`, {
                    defaultValue:
                      id === "summary"
                        ? "Summary"
                        : id === "transcript"
                          ? "Transcript"
                          : "Notes",
                  })}
                </span>
                {active && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-ink-100" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Tab content. The `min-h-[120vh]` guarantees the scroll
            container stays scrollable taller than the viewport even
            when the active tab has very little content (e.g. an
            empty Notes tab). Without it the browser would clamp
            scrollTop back to 0 on tab switch — pulling the hero
            image back into view and forcing the user to re-scroll. */}
        <div className="flex flex-1 min-h-[120vh] flex-col">
          {tab === "summary" && (
            <SummaryTab
              card={card}
              translation={activeTranslation}
              depth={summaryDepth}
              onDepthChange={setSummaryDepth}
            />
          )}
          {tab === "transcript" && (
            <TranscriptTab
              transcript={transcript}
              loading={transcriptLoading}
              youtubeVideoId={
                card.source_type === "youtube" ? card.external_id ?? null : null
              }
              youtubeUrl={card.source_url ?? null}
            />
          )}
          {tab === "notes" && <NotesTab card={card} />}
        </div>
      </div>
      )}

      {/* Sticky bottom CTA — opens the full card detail in the main
          Mindshift tab. Recall puts a chat composer here; we don't
          have an in-side-panel chat (yet), so a single primary action
          keeps the surface uncluttered. */}
      <div className="flex-shrink-0 border-t border-ink-800 bg-ink-900/95 p-2 backdrop-blur">
        <a
          href={cardLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-ink-100 px-3 py-2 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("embed.openInMindshift", { defaultValue: "Open in Mindshift" })}
        </a>
      </div>
    </div>
  );
}

/* ------------------------- tab bodies ------------------------- */

function SummaryTab({
  card,
  translation,
  depth,
  onDepthChange,
}: {
  card: Card;
  translation: CardTranslationOut | null;
  depth: SummaryDepth;
  onDepthChange: (d: SummaryDepth) => void;
}) {
  const text =
    depth === "concise"
      ? translation?.concise_summary_md ?? card.concise_summary_md
      : translation?.detailed_summary_md ?? card.detailed_summary_md;
  const takeaways = translation?.key_takeaways_json ?? card.key_takeaways_json ?? [];
  return (
    <div className="space-y-3 p-3">
      <div className="flex gap-1">
        <DepthPill active={depth === "concise"} onClick={() => onDepthChange("concise")}>
          Concise
        </DepthPill>
        <DepthPill active={depth === "detailed"} onClick={() => onDepthChange("detailed")}>
          Detailed
        </DepthPill>
      </div>
      {text ? (
        <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed text-ink-200">
          <MarkdownView source={text} />
        </div>
      ) : (
        <p className="text-xs text-ink-500">No {depth} summary available yet.</p>
      )}
      {takeaways.length > 0 && (
        <section className="border-t border-ink-800 pt-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Key takeaways
          </h3>
          <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink-200">
            {takeaways.map((tk, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex-shrink-0 text-ink-600">•</span>
                <span>{tk}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DepthPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1 text-[11px] font-medium transition",
        active
          ? "bg-ink-100 text-ink-900"
          : "border border-ink-700 bg-ink-800/40 text-ink-300 hover:bg-ink-800",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function TranscriptTab({
  transcript,
  loading,
  youtubeVideoId,
  youtubeUrl,
}: {
  transcript: TranscriptOut | null;
  loading: boolean;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
}) {
  const [query, setQuery] = useState("");
  if (loading || transcript === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-ink-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading transcript…
      </div>
    );
  }
  const segments = transcript.segments;
  if (!segments || segments.length === 0) {
    if (!transcript.text) {
      return <p className="p-4 text-xs text-ink-500">No transcript for this source.</p>;
    }
    return (
      <div className="whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-ink-200">
        {transcript.text}
      </div>
    );
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;
  const linkFor = (start: number): string | null => {
    if (youtubeVideoId) {
      return `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${Math.floor(start)}s`;
    }
    if (youtubeUrl && /youtube\.com|youtu\.be/i.test(youtubeUrl)) {
      const sep = youtubeUrl.includes("?") ? "&" : "?";
      return `${youtubeUrl}${sep}t=${Math.floor(start)}s`;
    }
    return null;
  };
  const fmt = (s: number) => {
    const tot = Math.floor(s);
    const h = Math.floor(tot / 3600);
    const m = Math.floor((tot % 3600) / 60);
    const ss = tot % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };
  return (
    <div className="p-3 text-[12px] leading-relaxed text-ink-200">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search transcript…"
        className="mb-3 w-full rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-[11px] text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
      />
      {filtered.length === 0 ? (
        <p className="text-ink-500">No segments match.</p>
      ) : (
        <ol className="space-y-1.5">
          {filtered.map((s, i) => {
            const url = linkFor(s.start);
            return (
              <li key={`${s.start}-${i}`} className="flex gap-2">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 font-mono text-[10px] tabular-nums text-fuchsia-400 hover:underline dark:text-fuchsia-300"
                  >
                    {fmt(s.start)}
                  </a>
                ) : (
                  <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-ink-500">
                    {fmt(s.start)}
                  </span>
                )}
                <span className="flex-1">{s.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function NotesTab({ card }: { card: Card }) {
  if (!card.notes_md) {
    return (
      <p className="p-4 text-xs text-ink-500">
        No notes yet. Open the full card in Mindshift to write some.
      </p>
    );
  }
  return (
    <div className="prose prose-invert prose-sm m-3 max-w-none rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-[12px] text-ink-200">
      <MarkdownView source={card.notes_md} />
    </div>
  );
}
