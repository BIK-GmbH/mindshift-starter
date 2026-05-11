import { ExternalLink, FileText, Link as LinkIcon, Loader2, MessageSquare, Moon, Search, StickyNote, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import CardLanguagePicker from "../components/CardLanguagePicker";
import ChatTab from "../components/cardTabs/ChatTab";
import IngestionSkeleton from "../components/IngestionSkeleton";
import MarkdownView from "../components/MarkdownView";
import {
  api,
  tokenStorage,
  type Card,
  type CardTranslationOut,
  type Connection,
  type SearchHit,
  type TranscriptOut,
} from "../lib/api";

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

type EmbedTab = "summary" | "transcript" | "notes" | "chat";
type SummaryDepth = "concise" | "detailed";

const TAB_ICONS: Record<EmbedTab, FC<{ className?: string }>> = {
  summary: FileText,
  transcript: FileText,
  notes: StickyNote,
  chat: MessageSquare,
};

/**
 * Side-panel embed view for the browser extension.
 *
 * Recall-inspired layout — every band except the tab content is fixed
 * so the user always sees the title + tags + tab strip + bottom CTA,
 * regardless of how far they've scrolled inside a long summary or
 * transcript.
 *
 *  ┌────────────────────────────────────────┐
 *  │ [Open ↗]  [Copy]              [⚙]      │  always-on-top mini bar
 *  ├────────────────────────────────────────┤
 *  │  Title + #tag #tag        [thumb]      │  compact fixed header
 *  ├────────────────────────────────────────┤
 *  │  Summary   Transcript   Notes   Chat   │  fixed tab strip
 *  ├────────────────────────────────────────┤
 *  │                                          │
 *  │  Tab content (the only scrolling band)  │
 *  │                                          │
 *  ├────────────────────────────────────────┤
 *  │  [ Open in Mindshift ↗ ]                │  fixed bottom CTA
 *  └────────────────────────────────────────┘
 *
 * Loaded inside an iframe from the extension; shares localStorage with
 * the main Mindshift tab so the JWT carries over automatically.
 */
export default function EmbedCardPage() {
  const { cardId = "" } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [defaultLang, setDefaultLang] = useState<string | null>(null);
  const autoTriggeredFor = useRef<Set<string>>(new Set());

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

  // Read the user's default-translation-language preference once per
  // mount. Auto-translate only fires when the preference is non-null
  // AND the card is completed (no point translating an empty card).
  useEffect(() => {
    if (!hasToken) return;
    void (async () => {
      try {
        const prefs = await api.getPreferences();
        setDefaultLang(prefs.default_translation_language);
      } catch {
        /* preferences endpoint missing or 401 — no auto-translate,
           but the panel still works. */
      }
    })();
  }, [hasToken]);

  // Trigger auto-translate when:
  //   - the user has a default language set
  //   - the card is finished processing
  //   - we haven't already kicked it off this mount (the picker would
  //     loop us into re-creation otherwise)
  // The CardLanguagePicker on the mini-bar then picks up the new
  // translation in its existing list/poll cycle and flips
  // `activeTranslation` once status="ready".
  useEffect(() => {
    if (!defaultLang) return;
    if (!card || card.status !== "completed") return;
    const key = `${card.id}::${defaultLang}`;
    if (autoTriggeredFor.current.has(key)) return;
    autoTriggeredFor.current.add(key);
    void (async () => {
      try {
        const existing = await api.listTranslations(card.id);
        const has = existing.some(
          (t2) => t2.language === defaultLang && t2.status !== "failed",
        );
        if (!has) {
          await api.createTranslation(card.id, defaultLang);
        }
      } catch {
        /* swallow — failure leaves the user on the original language,
           which is the same fallback we'd hit without preferences. */
      }
    })();
  }, [defaultLang, card?.id, card?.status]);

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

  // When the embed iframe runs inside the extension side panel,
  // `window.parent` is the side panel's HTML document — a privileged
  // context that can talk to chrome.tabs. When the embed runs as a
  // standalone tab (the Maximize / popOut link), there's no parent
  // and we fall back to opening YouTube directly at the timestamp.
  const isInIframe = typeof window !== "undefined" && window.parent !== window;

  const onTimestampClick = useCallback(
    (seconds: number) => {
      const videoId =
        card?.source_type === "youtube" ? card?.external_id ?? null : null;
      console.warn(
        "[mindshift] pill click — videoId:", videoId,
        "seconds:", seconds,
        "isInIframe:", isInIframe,
      );
      if (!videoId) return;
      if (isInIframe) {
        // Side panel listens for this and forwards it to the active
        // YouTube tab's content script.
        window.parent.postMessage(
          {
            type: "mindshift:seekVideo",
            videoId,
            seconds: Math.floor(seconds),
          },
          "*",
        );
        console.warn("[mindshift] posted to parent");
        return;
      }
      window.open(
        `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`,
        "_blank",
      );
      console.warn("[mindshift] standalone fallback: opened YouTube in new tab");
    },
    [card?.external_id, card?.source_type, isInIframe],
  );

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
    list.push("chat");
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
  // Pop-out target — same view as the iframe but in a full-width tab
  // so the user can effectively "scale to maximum" without dragging
  // the side panel itself. Chrome doesn't expose a programmatic
  // resize for the side panel, so window.open is the next best.
  const popOutLink = `${webOrigin}/cards/${card.id}`;

  return (
    <div className="embed-shell flex h-full flex-col overflow-hidden bg-ink-900 text-ink-100">
      <EmbedResponsiveStyle />
      {/* Always-on-top mini bar */}
      <div className="embed-bar flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-ink-800 bg-ink-900/95 px-2 py-1.5 backdrop-blur">
        <a
          href={popOutLink}
          target="_blank"
          rel="noopener noreferrer"
          title={t("embed.openInMindshiftTooltip", { defaultValue: "Open in Mindshift" }) ?? "Open in Mindshift"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
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
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition",
            copied ? "bg-emerald-500/15 text-emerald-300" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
          ].join(" ")}
        >
          {copied ? <span className="text-[11px]">✓</span> : <LinkIcon className="h-3.5 w-3.5" />}
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
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          title={t("embed.searchTooltip", { defaultValue: "Search library" }) ?? ""}
          className={[
            "ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md transition",
            searchOpen
              ? "bg-ink-800 text-ink-100"
              : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
          ].join(" ")}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        {card.status === "completed" && (
          <CardLanguagePicker
            cardId={card.id}
            onActive={setActiveTranslation}
            initialActiveLanguage={defaultLang}
          />
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

      {searchOpen && (
        <EmbedSearchStrip
          onClose={() => setSearchOpen(false)}
          onPick={(hit) => {
            setSearchOpen(false);
            if (hit.card_id !== cardId) {
              navigate(`/embed/cards/${hit.card_id}`);
            }
          }}
        />
      )}

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
        <>
          {/* Compact fixed header — Recall-style. Title + tags on the
              left, a small thumbnail on the right. Stays put while the
              tab content below scrolls. */}
          <CompactHeader
            title={activeTranslation?.title ?? card.title}
            tags={card.tags ?? []}
            thumbnailUrl={card.thumbnail_url ?? null}
          />

          {/* Fixed tab strip — sticky is no longer needed because the
              outer flex layout pins us above the scroll container. */}
          <TabStrip tabs={tabs} tab={tab} setTab={setTab} t={t} />

          {/* The ONLY scrolling band. min-h-0 is load-bearing under a
              flex parent — without it the child's content would push
              the container instead of clipping + scrolling. */}
          <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
            <div className="embed-tab-content flex flex-1 min-h-0 flex-col p-3">
              {tab === "summary" && (
                <SummaryTab
                  card={card}
                  translation={activeTranslation}
                  depth={summaryDepth}
                  onDepthChange={setSummaryDepth}
                  onPickRelated={(c) => navigate(`/embed/cards/${c.card_id}`)}
                  onTimestampClick={onTimestampClick}
                />
              )}
              {tab === "transcript" && (
                <TranscriptTab
                  transcript={transcript}
                  loading={transcriptLoading}
                  youtubeVideoId={
                    card.source_type === "youtube"
                      ? card.external_id ?? null
                      : null
                  }
                  youtubeUrl={card.source_url ?? null}
                  onTimestampClick={onTimestampClick}
                />
              )}
              {tab === "notes" && <NotesTab card={card} />}
              {tab === "chat" && (
                <ChatTab card={card} showSourceMedia={false} fitParent />
              )}
            </div>
          </div>
        </>
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

/* ------------------------- compact header ------------------------- */

/**
 * Fixed compact header — replaces the old scroll-away hero. Sits above
 * the tab strip and stays put while the user scrolls through summary
 * or transcript. Layout: title + tag pills on the left, a small
 * thumbnail on the right (when available).
 */
function CompactHeader({
  title,
  tags,
  thumbnailUrl,
}: {
  title: string;
  tags: string[];
  thumbnailUrl: string | null;
}) {
  return (
    <div className="flex flex-shrink-0 items-start gap-3 border-b border-ink-800 bg-ink-900/95 px-3 py-2 backdrop-blur">
      <div className="min-w-0 flex-1">
        <h1 className="embed-title line-clamp-2 text-[13px] font-semibold leading-snug text-ink-100">
          {title}
        </h1>
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tg) => (
              <span
                key={tg}
                className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
              >
                #{tg}
              </span>
            ))}
          </div>
        )}
      </div>
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          className="aspect-video w-24 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
        />
      )}
    </div>
  );
}

/* ------------------------- tab strip ------------------------- */

/**
 * Fixed tab strip — sits between the compact header and the scrollable
 * tab content. The outer layout already pins this band, so the legacy
 * `sticky` prop is now a no-op kept for callers that still pass it.
 */
function TabStrip({
  tabs,
  tab,
  setTab,
  t,
  sticky = false,
}: {
  tabs: EmbedTab[];
  tab: EmbedTab;
  setTab: (id: EmbedTab) => void;
  t: ReturnType<typeof useTranslation>["t"];
  sticky?: boolean;
}) {
  return (
    <nav
      className={[
        "flex flex-shrink-0 gap-0.5 border-b border-ink-800 bg-ink-900/95 px-2 backdrop-blur",
        sticky ? "sticky top-0 z-10" : "",
      ].join(" ")}
    >
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
                      : id === "notes"
                        ? "Notes"
                        : "Chat",
              })}
            </span>
            {active && (
              <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-ink-100" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------- tab bodies ------------------------- */

function SummaryTab({
  card,
  translation,
  depth,
  onDepthChange,
  onPickRelated,
  onTimestampClick,
}: {
  card: Card;
  translation: CardTranslationOut | null;
  depth: SummaryDepth;
  onDepthChange: (d: SummaryDepth) => void;
  onPickRelated: (c: Connection) => void;
  onTimestampClick?: (seconds: number) => void;
}) {
  const text =
    depth === "concise"
      ? translation?.concise_summary_md ?? card.concise_summary_md
      : translation?.detailed_summary_md ?? card.detailed_summary_md;
  const takeaways = translation?.key_takeaways_json ?? card.key_takeaways_json ?? [];
  const videoId = card.source_type === "youtube" ? card.external_id ?? null : null;
  const sourceUrl = card.source_url ?? null;
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
          <MarkdownView
            source={text}
            youtubeVideoId={videoId}
            youtubeUrl={sourceUrl}
            onTimestampClick={onTimestampClick}
          />
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
                <span className="flex-1">
                  <MarkdownView
                    source={typeof tk === "string" ? tk : ""}
                    youtubeVideoId={videoId}
                    youtubeUrl={sourceUrl}
                    onTimestampClick={onTimestampClick}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RelatedCardsStrip cardId={card.id} onPick={onPickRelated} />
    </div>
  );
}

/* ----------------------- related-cards strip ----------------------- */

/**
 * Bottom-of-summary row of cards the edge engine considers semantically
 * related. Hidden when there are no connections (new cards), so the
 * surface stays clean. Loading state shows three skeleton tiles to
 * preserve layout height across the swap-in.
 */
function RelatedCardsStrip({
  cardId,
  onPick,
}: {
  cardId: string;
  onPick: (c: Connection) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems(null);
    void (async () => {
      try {
        const result = await api.cardConnections(cardId, 5);
        if (!cancelled) setItems(result);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // Hide once we know there are no connections — keeps the surface
  // clean for fresh cards before the edge engine has had a chance.
  if (!loading && (items?.length ?? 0) === 0) return null;

  return (
    <section className="border-t border-ink-800 pt-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {t("embed.related", { defaultValue: "Related cards" })}
      </h3>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 w-32 flex-shrink-0 animate-shimmer rounded-md bg-gradient-to-r from-ink-800 via-ink-700/60 to-ink-800"
              />
            ))
          : items?.map((c) => (
              <button
                key={c.card_id}
                type="button"
                onClick={() => onPick(c)}
                className="embed-related-tile group flex w-32 flex-shrink-0 flex-col gap-1.5 text-left"
                title={c.title}
              >
                {c.thumbnail_url ? (
                  <img
                    src={c.thumbnail_url}
                    alt=""
                    className="aspect-video w-full rounded-md object-cover ring-1 ring-ink-700 transition group-hover:ring-ink-500"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-md bg-ink-800 text-[8px] uppercase text-ink-500 ring-1 ring-ink-700 transition group-hover:ring-ink-500">
                    {c.source_type}
                  </div>
                )}
                <p className="line-clamp-2 text-[10px] leading-tight text-ink-200 group-hover:text-ink-100">
                  {c.title}
                </p>
                {c.reasons[0] && (
                  <span className="inline-flex w-fit rounded-full bg-ink-800/80 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-ink-400">
                    {c.reasons[0].kind}
                  </span>
                )}
              </button>
            ))}
      </div>
    </section>
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
  onTimestampClick,
}: {
  transcript: TranscriptOut | null;
  loading: boolean;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  onTimestampClick?: (seconds: number) => void;
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
            // Prefer steering the host YouTube tab via onTimestampClick
            // (set by EmbedCardPage when inside the side panel iframe);
            // fall back to opening the timestamped URL in a new tab.
            return (
              <li key={`${s.start}-${i}`} className="flex gap-2">
                {onTimestampClick ? (
                  <button
                    type="button"
                    onClick={() => onTimestampClick(s.start)}
                    className="flex-shrink-0 font-mono text-[10px] tabular-nums text-fuchsia-400 hover:underline dark:text-fuchsia-300"
                  >
                    {fmt(s.start)}
                  </button>
                ) : url ? (
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

/**
 * In-panel notes editor. Lightweight by design — a textarea with
 * markdown, debounced auto-save (1500 ms idle). Heavy editing flows
 * stay in the main app's TipTap editor; the side panel is for quick
 * captures.
 *
 * Save semantics:
 *  - "saving" while a request is in flight
 *  - "saved" briefly after a successful round-trip (auto-clears)
 *  - "error" persists until the next successful save or manual retry
 *
 * The textarea state is the source of truth — we never overwrite it
 * with `card.notes_md` after first mount, so a save failure doesn't
 * lose the user's typing.
 */
function NotesTab({ card }: { card: Card }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(card.notes_md ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(card.notes_md ?? "");
  const cardIdRef = useRef<string>(card.id);

  // When the parent navigates to a different card, reset the draft
  // to that card's notes. Comparing card.id catches the swap; the
  // dep array ensures we don't clobber the user's typing on every
  // poll-driven re-render of the same card.
  useEffect(() => {
    if (cardIdRef.current !== card.id) {
      cardIdRef.current = card.id;
      setDraft(card.notes_md ?? "");
      lastSavedRef.current = card.notes_md ?? "";
      setStatus("idle");
      setErrorMessage(null);
    }
  }, [card.id, card.notes_md]);

  // Debounced auto-save. Cancels on every keystroke and re-arms.
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const timer = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await api.updateNotes(card.id, draft);
        lastSavedRef.current = draft;
        setStatus("saved");
        setErrorMessage(null);
        // Clear the "saved" pill after a beat so the bar is quiet
        // when the user is just reading what they wrote.
        window.setTimeout(() => {
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 1500);
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Save failed");
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [draft, card.id]);

  const retry = async () => {
    setStatus("saving");
    try {
      await api.updateNotes(card.id, draft);
      lastSavedRef.current = draft;
      setStatus("saved");
      setErrorMessage(null);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-500">
        <span>{t("embed.notes.label", { defaultValue: "Notes" })}</span>
        {status === "saving" && (
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-ink-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("embed.notes.saving", { defaultValue: "Saving…" })}
          </span>
        )}
        {status === "saved" && (
          <span className="normal-case tracking-normal text-emerald-400">
            {t("embed.notes.saved", { defaultValue: "Saved" })}
          </span>
        )}
        {status === "error" && (
          <button
            type="button"
            onClick={() => void retry()}
            className="rounded border border-red-500/40 px-1.5 py-0.5 normal-case tracking-normal text-red-300 transition hover:bg-red-500/10"
            title={errorMessage ?? ""}
          >
            {t("embed.notes.retry", { defaultValue: "Retry save" })}
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          t("embed.notes.placeholder", {
            defaultValue: "Type your notes — Markdown welcome. Auto-saves.",
          }) ?? ""
        }
        spellCheck={true}
        className="min-h-[160px] flex-1 resize-y rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed text-ink-100 outline-none transition focus:border-ink-600 focus:bg-ink-900/95"
      />
    </div>
  );
}

/* ------------------------- inline search ------------------------- */

/**
 * Library search strip that drops in below the mini-bar. Debounced
 * keystrokes hit `searchKeyword` (320 chars max snippet, 20 hits).
 * Hover renders a tiny preview snippet; click hands the chosen
 * SearchHit back to the parent which navigates the iframe.
 */
function EmbedSearchStrip({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the input on mount so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes the strip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search. The cleanup runs every time `query` changes, so
  // an in-flight timer for the previous keystroke gets cancelled —
  // the API only sees the user's last 250 ms-stable query.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.searchKeyword(q, 12);
        // Dedup by card_id — transcript-segment hits and card hits
        // for the same card collapse to one row in the dropdown.
        const seen = new Set<string>();
        const deduped: SearchHit[] = [];
        for (const h of result) {
          if (seen.has(h.card_id)) continue;
          seen.add(h.card_id);
          deduped.push(h);
        }
        setHits(deduped);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/95 backdrop-blur">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-ink-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            t("embed.searchPlaceholder", {
              defaultValue: "Search your library…",
            }) ?? ""
          }
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-100 outline-none placeholder:text-ink-500"
        />
        {loading && <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-ink-500" />}
        <button
          type="button"
          onClick={onClose}
          title={t("common.close", { defaultValue: "Close" }) ?? ""}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="max-h-72 overflow-y-auto border-t border-ink-800 py-1">
          {hits.map((h) => (
            <li key={h.card_id}>
              <button
                type="button"
                onClick={() => onPick(h)}
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition hover:bg-ink-800/60"
              >
                {h.thumbnail_url ? (
                  <img
                    src={h.thumbnail_url}
                    alt=""
                    className="h-8 w-12 flex-shrink-0 rounded object-cover ring-1 ring-ink-700"
                  />
                ) : (
                  <div className="flex h-8 w-12 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-[8px] uppercase text-ink-500 ring-1 ring-ink-700">
                    {h.source_type}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium leading-tight text-ink-100">
                    {h.title}
                  </p>
                  {h.snippet && (
                    <p className="line-clamp-2 text-[10px] leading-snug text-ink-500">
                      {h.snippet}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && query.trim().length >= 2 && hits.length === 0 && (
        <p className="border-t border-ink-800 px-3 py-2 text-[11px] text-ink-500">
          {t("embed.searchEmpty", { defaultValue: "No matches." })}
        </p>
      )}
    </div>
  );
}

/* ----------------------- responsive container queries ----------------------- */

/**
 * Container-driven responsive rules for the side panel embed. Chrome
 * lets the user resize the side panel horizontally; we adapt to the
 * panel's *own* width via @container queries (not viewport queries —
 * the embed iframe's viewport is the side panel's width, but the
 * primitive is more accurate when nested under other layouts later).
 *
 * Three states:
 *   - narrow  (<360 px): icon-only mini-bar, tight padding, smaller hero
 *   - medium  (360–520 px): the historical default
 *   - wide    (≥520 px): roomier paddings + larger title + bigger
 *                          related-card tiles
 *
 * Tailwind container queries aren't enabled in this project's
 * tailwind.config — we ship the rules as a small inline <style>
 * scoped to the `.embed-shell` container. Cheap, no new plugin.
 */
function EmbedResponsiveStyle() {
  return (
    <style>{`
      .embed-shell {
        container-type: inline-size;
        container-name: embed;
      }

      /* Narrow: tighten the compact header type — gives the language
         picker + theme toggle room to fit on a single line at Chrome's
         minimum side-panel width. */
      @container embed (max-width: 359px) {
        .embed-bar { gap: 4px !important; padding-left: 6px; padding-right: 6px; }
        .embed-title { font-size: 12px !important; }
      }

      /* Wide: more breathing room — bigger title, wider related-card
         tiles, more padding around the tab content. */
      @container embed (min-width: 520px) {
        .embed-title { font-size: 14px !important; }
        .embed-related-tile { width: 168px !important; }
        .embed-tab-content { padding: 16px !important; }
      }

      /* Wide enough to widen the prose comfortably. The tab content
         now fills the whole panel width past 720 px so the prose
         doesn't get letterboxed at intermediate widths. */
      @container embed (min-width: 720px) {
        .embed-title { font-size: 15px !important; }
        .embed-tab-content { padding: 24px !important; }
      }

      /* Larger paddings at very wide widths — but NO max-width clamp,
         so the prose keeps filling the panel instead of centring in a
         letterbox the user has to scroll inside of. */
      @container embed (min-width: 960px) {
        .embed-tab-content { padding: 28px !important; }
      }
    `}</style>
  );
}
