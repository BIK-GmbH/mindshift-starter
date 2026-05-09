import { ExternalLink, FileText, Loader2, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import { api, tokenStorage, type Card } from "../lib/api";

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
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Lazy-load transcript only when the user opens that tab.
  useEffect(() => {
    if (tab !== "transcript" || transcriptText !== null || !card) return;
    setTranscriptLoading(true);
    void (async () => {
      try {
        const data = await api.getTranscript(cardId);
        setTranscriptText(data.text ?? "");
      } catch {
        setTranscriptText("");
      } finally {
        setTranscriptLoading(false);
      }
    })();
  }, [tab, cardId, transcriptText, card]);

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
        <span className="ml-auto rounded-full bg-ink-800/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-400">
          {card.source_type}
        </span>
      </div>

      {/* Scrollable body */}
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
              {card.title}
            </h1>
          </div>
        ) : (
          <div className="flex-shrink-0 border-b border-ink-800 px-3 py-3">
            <h1 className="text-base font-semibold leading-snug text-ink-100">{card.title}</h1>
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
            <SummaryTab card={card} depth={summaryDepth} onDepthChange={setSummaryDepth} />
          )}
          {tab === "transcript" && (
            <TranscriptTab text={transcriptText} loading={transcriptLoading} />
          )}
          {tab === "notes" && <NotesTab card={card} />}
        </div>
      </div>

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
  depth,
  onDepthChange,
}: {
  card: Card;
  depth: SummaryDepth;
  onDepthChange: (d: SummaryDepth) => void;
}) {
  const text = depth === "concise" ? card.concise_summary_md : card.detailed_summary_md;
  const takeaways = card.key_takeaways_json ?? [];
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
  text,
  loading,
}: {
  text: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-ink-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading transcript…
      </div>
    );
  }
  if (!text) {
    return <p className="p-4 text-xs text-ink-500">No transcript for this source.</p>;
  }
  return (
    <div className="whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-ink-200">
      {text}
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
