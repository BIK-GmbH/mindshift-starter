import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Highlighter,
  Link2,
  Loader2,
  Maximize2,
  MessageSquare,
  Network,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  RefreshCw,
  RotateCw,
  Share2,
  Sparkles,
  Headphones,
  StickyNote,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import CardGraph from "./CardGraph";
import CardSourceMedia from "./CardSourceMedia";
import CardLanguagePicker from "./CardLanguagePicker";
import CardPodcastPlayer from "./CardPodcastPlayer";
import CardTagsBar from "./CardTagsBar";
import { markdownToPlainText } from "./MarkdownView";
import ShareModal from "./ShareModal";
import IngestionSkeleton from "./IngestionSkeleton";
import StatusBadge from "./StatusBadge";
import ChatTab from "./cardTabs/ChatTab";
import HighlightsTab from "./cardTabs/HighlightsTab";
import NotesTab from "./cardTabs/NotesTab";
import PostsTab from "./cardTabs/PostsTab";
import QuizTab from "./cardTabs/QuizTab";
import RelatedTab from "./cardTabs/RelatedTab";
import SummaryTab from "./cardTabs/SummaryTab";
import TranscriptTab from "./cardTabs/TranscriptTab";
import { useDialog } from "../lib/DialogContext";
import { api, type Card, type CardTranslationOut, type QuizQuestion, type TranscriptOut } from "../lib/api";
import { emit } from "../lib/events";

export type CardDetailTab =
  | "summary"
  | "transcript"
  | "notes"
  | "highlights"
  | "quiz"
  | "chat"
  | "related"
  | "graph"
  | "podcast"
  | "posts";

const TAB_ICONS: Record<CardDetailTab, FC<{ className?: string }>> = {
  summary: BookOpen,
  transcript: FileText,
  notes: StickyNote,
  highlights: Highlighter,
  quiz: Sparkles,
  chat: MessageSquare,
  related: Link2,
  graph: Network,
  podcast: Headphones,
  posts: Megaphone,
};

interface Props {
  cardId: string;
  /** Called when the user clicks back / X. */
  onBack: () => void;
  /** Render the back affordance as a left-pointing chevron link (page mode)
   *  or as a small close X (embedded panel mode). */
  backStyle?: "link" | "close";
  /** Compact horizontal padding when embedded inside a narrow library pane. */
  compact?: boolean;
  /** Initial active tab. */
  initialTab?: CardDetailTab;
  /** When set, hide the chat tab from the strip — used when chat lives in a
   *  separate side pane rendered by the parent. */
  hideChatTab?: boolean;
  /** Notify the parent whenever the card object refreshes — used by
   *  the library so it can render its right-side chat pane (with an
   *  optional source-media panel above) without re-fetching. */
  onCardLoaded?: (card: Card) => void;
}

export default function CardDetailContent({
  cardId,
  onBack,
  backStyle = "link",
  compact = false,
  initialTab = "summary",
  hideChatTab = false,
  onCardLoaded,
}: Props) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [activeTranslation, setActiveTranslation] = useState<CardTranslationOut | null>(null);
  const [tab, setTab] = useState<CardDetailTab>(initialTab);
  const [transcript, setTranscript] = useState<TranscriptOut | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mobile mini-player wiring — see MobileMediaPin section below.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mediaSentinelRef = useRef<HTMLDivElement>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const [mediaPinned, setMediaPinned] = useState(false);

  const fetchCard = useCallback(async () => {
    try {
      const data = await api.getCard(cardId);
      setCard(data);
      setNotes(data.notes_md ?? "");
      setError(null);
      onCardLoaded?.(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId, onCardLoaded]);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  // Reset transient per-card state when cardId changes (so switching cards in
  // an embedded view doesn't leak the previous card's transcript or notes).
  useEffect(() => {
    setTab(initialTab);
    setTranscript(null);
    setQuiz([]);
  }, [cardId, initialTab]);

  useEffect(() => {
    if (!card) return;
    if (card.status === "completed" || card.status === "failed") return;
    const handle = window.setInterval(() => void fetchCard(), 2500);
    return () => window.clearInterval(handle);
  }, [card, fetchCard]);

  // Mobile sticky-on-scroll mini-player. The media block at the top
  // of the scroll container holds a sentinel; once it crosses the
  // root's top edge, the inner element becomes a fixed-position
  // mini in the top-right corner. Mirror of the desktop pattern in
  // PathPlayerCardView, but mobile-only — desktop already gets a
  // right-pane chat with media, no need to pin in the centre column.
  const mediaPinEligible =
    (card?.source_type === "youtube" && !!card?.external_id) ||
    card?.source_type === "pdf" ||
    (card?.source_type === "github" && !!card?.thumbnail_url);
  useEffect(() => {
    if (!mediaPinEligible) {
      setMediaPinned(false);
      return;
    }
    const sentinel = mediaSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    let observer: IntersectionObserver | null = null;
    const enable = () => {
      observer = new IntersectionObserver(
        ([entry]) => setMediaPinned(!entry.isIntersecting),
        { root, threshold: 0 },
      );
      observer.observe(sentinel);
    };
    const disable = () => {
      observer?.disconnect();
      observer = null;
      setMediaPinned(false);
    };
    if (mobileQuery.matches) enable();
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) enable();
      else disable();
    };
    mobileQuery.addEventListener("change", onChange);
    return () => {
      observer?.disconnect();
      mobileQuery.removeEventListener("change", onChange);
    };
  }, [mediaPinEligible, tab]);

  const scrollToMediaTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (tab === "transcript" && transcript === null && card?.status === "completed") {
      void api
        .getTranscript(cardId)
        .then(setTranscript)
        .catch((err) =>
          setTranscript({
            card_id: cardId,
            language: null,
            provider: null,
            text: (err as Error).message,
            segments: null,
          }),
        );
    }
    if (tab === "quiz" && quiz.length === 0 && card?.status === "completed") {
      void api.getQuiz(cardId).then(setQuiz).catch(() => undefined);
    }
  }, [tab, cardId, transcript, quiz.length, card?.status]);

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      const updated = await api.updateNotes(cardId, notes);
      setCard(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t("card.deleteTitle", { defaultValue: "Delete this card?" }),
      body: t("card.deleteBody", {
        defaultValue:
          "This permanently removes the card, its transcript, summaries, notes and quiz items. The action cannot be undone.",
      }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await api.deleteCard(cardId);
    // Broadcast so unrelated panels (tag tree, library card list,
    // graph view, …) can refresh without prop-drilling.
    emit("card-deleted", { cardId });
    onBack();
  };

  const handleRegenerate = async () => {
    try {
      await api.regenerateCard(cardId);
      await fetchCard();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Re-ingest for a completed card — same endpoint as the failed-card
  // "Retry" button, but here we ask for confirmation because the
  // current summary / takeaways / tags / quiz will be overwritten when
  // the new run finishes.
  const handleReingest = async () => {
    const ok = await confirm({
      title: t("card.reingestTitle", { defaultValue: "Re-ingest this card?" }),
      body: t("card.reingestBody", {
        defaultValue:
          "The transcript will be re-fetched, and the summary, key takeaways, tags and quiz questions will be regenerated. Notes you've added stay intact.",
      }),
      confirmLabel: t("card.reingestConfirm", { defaultValue: "Re-ingest" }),
    });
    if (!ok) return;
    try {
      await api.regenerateCard(cardId);
      await fetchCard();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const downloadMarkdown = (e: React.MouseEvent) => {
    if (!card) return;
    const token = localStorage.getItem("mindshift.token");
    if (!token) return;
    e.preventDefault();
    void fetch(api.exportCardMarkdownUrl(cardId), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${card.title.replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 80) || "card"}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
  };

  const buildMarkdown = (): string => {
    if (!card) return "";
    const lines: string[] = [`# ${card.title}`, ""];
    if (card.concise_summary_md) {
      lines.push("## TL;DR", "", card.concise_summary_md.trim(), "");
    }
    if (card.key_takeaways_json && card.key_takeaways_json.length > 0) {
      lines.push("## Key takeaways", "");
      for (const item of card.key_takeaways_json) {
        const text = typeof item === "string" ? item : (item as { text?: string })?.text;
        if (text) lines.push(`- ${text}`);
      }
      lines.push("");
    }
    if (card.detailed_summary_md) {
      lines.push("## Summary", "", card.detailed_summary_md.trim(), "");
    }
    if (card.notes_md) {
      lines.push("## Notes", "", card.notes_md.trim(), "");
    }
    return lines.join("\n").trim() + "\n";
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(buildMarkdown());
  };

  const copyPlainText = async () => {
    await navigator.clipboard.writeText(markdownToPlainText(buildMarkdown()));
  };

  const downloadOriginalFile = async (fileId: string) => {
    const token = localStorage.getItem("mindshift.token");
    if (!token) return;
    const res = await fetch(api.fileDownloadUrl(fileId), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const filename = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "original";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-300">
        {error ? <p className="text-red-400">{error}</p> : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </span>
        )}
      </div>
    );
  }

  const canRegenerate = card.status === "failed" && card.source_type !== "pdf";
  // Re-ingest is only meaningful on cards that have already finished —
  // running it while one is queued/processing would race. PDF cards
  // need the original blob in storage; the failed-PDF branch is
  // gated separately in the backend so we keep the same restriction.
  const canReingest =
    card.status === "completed" &&
    card.source_type !== "note" &&
    !(card.source_type === "pdf" && !card.original_file_id);
  const allTabs: CardDetailTab[] = [
    "summary",
    "transcript",
    "notes",
    "highlights",
    "quiz",
    "posts",
    "chat",
    "related",
    "graph",
    "podcast",
  ];
  const tabs = hideChatTab ? allTabs.filter((id) => id !== "chat") : allTabs;
  // Mobile (<sm) gets 12 px lateral padding so a 390 px iPhone has
  // 366 px usable content width — desktop keeps 32 px.
  const horizPad = compact ? "px-3 sm:px-5" : "px-3 sm:px-8";
  const innerWidth = compact ? "max-w-none" : "max-w-4xl";

  return (
    <div className="flex h-full flex-col">
      {/* Sticky top region */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className={`mx-auto ${innerWidth} ${horizPad} pb-2 pt-3 sm:pt-5`}>
          {/* Back affordance — desktop gets the full "← BIBLIOTHEK"
              text-link row; mobile drops the row entirely (it ate
              ~32 px of vertical space above the player) and the
              equivalent action moves into the meta-pills row below
              as a chevron-icon button. The page-level
              MobileTopBar's hamburger plus the bottom-nav's Library
              icon already give the user two redundant ways back. */}
          {backStyle === "link" ? (
            <button
              type="button"
              onClick={onBack}
              className="group hidden items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400 transition hover:text-ink-100 sm:inline-flex"
            >
              <ArrowLeft className="h-3 w-3 transition group-hover:-translate-x-0.5" />
              {t("nav.library")}
            </button>
          ) : (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onBack}
                title={t("common.cancel") ?? ""}
                className="rounded p-1 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Header — desktop side-by-side (thumbnail + content + ActionBar)
              vs mobile stacked (thumbnail full-width hero, then content,
              then ActionBar as its own row at the bottom of the
              header). The mobile path was previously one column with
              a 128 × 80 thumbnail next to a 178 px text column,
              which forced the title to break word-by-word — fixed by
              going full-width thumbnail at <sm. */}
          {/* Header — desktop side-by-side (thumbnail + content + ActionBar)
              vs mobile stacked. Important: no `items-start` on the
              mobile path; otherwise the inner content div doesn't
              stretch to the parent's width and the h1 can blow past
              the viewport on long unbroken titles. */}
          <header className="mt-0 flex flex-col gap-3 sm:mt-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
              {/* Mobile-only thumbnail block — hidden when the card is
                  pinnable (YouTube/PDF) because the active player
                  below the header serves the same visual hook AND
                  is tappable. Articles + notes still show the
                  thumbnail here on mobile. Desktop always shows the
                  small 128 × 80 thumbnail to anchor the title row. */}
              {card.thumbnail_url ? (
                <img
                  src={card.thumbnail_url}
                  alt=""
                  className={[
                    "flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700",
                    "sm:block sm:h-20 sm:w-32 sm:aspect-auto sm:w-32",
                    mediaPinEligible
                      ? "hidden sm:block"
                      : "aspect-video w-full",
                  ].join(" ")}
                />
              ) : (
                <div
                  className={[
                    "flex flex-shrink-0 items-center justify-center rounded-md bg-ink-800 ring-1 ring-ink-700",
                    "sm:h-20 sm:w-32 sm:aspect-auto",
                    mediaPinEligible
                      ? "hidden sm:flex"
                      : "aspect-video w-full",
                  ].join(" ")}
                >
                  <Type className="h-5 w-5 text-ink-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {/* Mobile-only back-icon — replaces the dropped
                      "← BIBLIOTHEK" row above. The arrow leads the
                      meta strip so the user reads it as a navigation
                      affordance, not a status pill. */}
                  {backStyle === "link" && (
                    <button
                      type="button"
                      onClick={onBack}
                      title={t("nav.library") ?? "Back"}
                      aria-label={t("nav.library") ?? "Back"}
                      className="-ml-1 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-ink-400 transition active:bg-ink-800 hover:bg-ink-800 hover:text-ink-100 sm:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  )}
                  <StatusBadge status={card.status} />
                  <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">
                    {card.source_type}
                  </span>
                  {card.status === "completed" && (
                    <CardLanguagePicker
                      cardId={card.id}
                      onActive={setActiveTranslation}
                    />
                  )}
                </div>
                <h1 className="break-words text-lg font-semibold leading-tight tracking-tight text-ink-100">
                  {activeTranslation?.title ?? card.title}
                </h1>
                {card.status === "completed" && (
                  <div className="mt-2">
                    <CardTagsBar
                      cardId={card.id}
                      initialTags={card.tags ?? []}
                      onTagsChanged={(tags) => setCard((prev) => (prev ? { ...prev, tags } : prev))}
                    />
                  </div>
                )}
                {card.is_public && card.public_via_tags && card.public_via_tags.length > 0 && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                    <Globe className="h-3 w-3" />
                    {t("card.publicVia", { defaultValue: "Public via" })}
                    {card.public_via_tags.slice(0, 2).map((p) => (
                      <span key={p} className="font-mono">#{p}</span>
                    ))}
                    {card.public_via_tags.length > 2 && (
                      <span className="text-emerald-400/80">
                        +{card.public_via_tags.length - 2}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Desktop ActionBar — own column at the right of the
                header. Hidden on mobile; the same actions fold into
                the tab-strip nav row below to free up an entire row. */}
            <div className="hidden sm:block">
              <ActionBar
                canRegenerate={canRegenerate}
                onRegenerate={handleRegenerate}
                canReingest={canReingest}
                onReingest={handleReingest}
                onDownload={downloadMarkdown}
                onCopyMarkdown={copyMarkdown}
                onCopyPlain={copyPlainText}
                onDownloadOriginal={
                  card.original_file_id
                    ? () => downloadOriginalFile(card.original_file_id!)
                    : undefined
                }
                onShare={() => setShareOpen(true)}
                onDelete={handleDelete}
                sourceUrl={
                  card.source_type !== "note" &&
                  card.source_url &&
                  /^https?:\/\//i.test(card.source_url)
                    ? card.source_url
                    : null
                }
                t={t}
              />
            </div>
          </header>
        </div>

        <div className={`mx-auto ${innerWidth} ${horizPad}`}>
          {/* Tab strip + (mobile) ActionBar in one row.
             *
             * Layout: outer <nav> is a non-scrolling flex row. Tabs
             * live in an inner div with horizontal scroll (flex-1
             * min-w-0) so the ActionBar on the right never scrolls
             * out of view — only the tab list scrolls.
             *
             * Touch fix: `touch-action: pan-x` on the inner scroller
             * tells the browser the element claims horizontal pans,
             * so vertical swipes pass through to the body. Without
             * this, dragging the tabs sideways on mobile fought the
             * page's vertical scroll and the strip felt sticky-shaky.
             *
             * Trailing fade hints there's more on the right when the
             * active tab is part-way and tabs overflow.
             */}
          <nav className="flex items-center gap-0.5" aria-label="card sections">
            <TabScrollChevron direction="left" scrollerRef={tabScrollerRef} />
            <div
              ref={tabScrollerRef}
              className="no-scrollbar relative flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
              style={{ touchAction: "pan-x", overscrollBehaviorX: "contain" }}
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
                      "group relative inline-flex flex-shrink-0 items-center gap-1.5 px-2.5 pb-2 pt-1.5 text-sm transition-colors sm:px-3 sm:pb-3 sm:pt-2",
                      active ? "text-ink-100" : "text-ink-400 hover:text-ink-200",
                    ].join(" ")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t(`card.${id}`)}</span>
                    {active && (
                      <span className="tab-indicator absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-ink-100" />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Right-edge fade — purely cosmetic affordance on mobile
                that the tab list keeps going. Pointer-events:none so
                it never blocks taps on the underlying tabs. */}
            <span
              aria-hidden="true"
              className="pointer-events-none -ml-6 h-7 w-6 flex-shrink-0 bg-gradient-to-l from-ink-900 to-transparent sm:hidden"
            />
            <TabScrollChevron direction="right" scrollerRef={tabScrollerRef} />
            <div className="flex-shrink-0 sm:hidden">
              <ActionBar
                canRegenerate={canRegenerate}
                onRegenerate={handleRegenerate}
                canReingest={canReingest}
                onReingest={handleReingest}
                onDownload={downloadMarkdown}
                onCopyMarkdown={copyMarkdown}
                onCopyPlain={copyPlainText}
                onDownloadOriginal={
                  card.original_file_id
                    ? () => downloadOriginalFile(card.original_file_id!)
                    : undefined
                }
                onShare={() => setShareOpen(true)}
                onDelete={handleDelete}
                sourceUrl={
                  card.source_type !== "note" &&
                  card.source_url &&
                  /^https?:\/\//i.test(card.source_url)
                    ? card.source_url
                    : null
                }
                t={t}
              />
            </div>
          </nav>
        </div>
      </div>

      {/* Scrolling content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* Mobile media block — only shown for YouTube + PDF cards
            on `<md`. Holds an active CardSourceMedia (YouTube embed
            / PdfReader) and a sentinel that triggers the pin via
            IntersectionObserver. The aspect-video reservation keeps
            the layout stable when the inner element flips to fixed
            position so the content below doesn't jump. */}
        {mediaPinEligible && (
          <div className="border-b border-ink-800 bg-ink-950/40 md:hidden">
            <div className="px-3 py-3">
              <div
                className={`relative ${
                  card.source_type === "pdf"
                    ? "aspect-[3/4]"
                    : card.source_type === "github"
                      ? "aspect-[2/1]" // matches GitHub OG image aspect ratio
                      : "aspect-video"
                }`}
              >
                <div
                  className={[
                    "overflow-hidden rounded-md ring-1 transition-all duration-300 ease-out",
                    mediaPinned
                      ? card.source_type === "pdf"
                        ? "fixed right-3 top-16 z-30 h-48 w-36 shadow-2xl ring-ink-700"
                        : card.source_type === "github"
                          ? "fixed right-3 top-16 z-30 aspect-[2/1] w-44 shadow-2xl ring-ink-700"
                          : "fixed right-3 top-16 z-30 aspect-video w-48 shadow-2xl ring-ink-700"
                      : "absolute inset-0 ring-transparent",
                  ].join(" ")}
                >
                  <CardSourceMedia card={card} compact={mediaPinned} />
                  {mediaPinned && (
                    <button
                      type="button"
                      onClick={scrollToMediaTop}
                      title={t("paths.maximizeVideo", { defaultValue: "Maximize" }) ?? ""}
                      aria-label={t("paths.maximizeVideo", { defaultValue: "Maximize" }) ?? ""}
                      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/85 text-ink-200 transition active:bg-ink-800 hover:bg-ink-800 hover:text-ink-100"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Sentinel — when this scrolls past the container's top
            edge, the observer flips mediaPinned. 1 px height + the
            aria-hidden so screen readers ignore it. */}
        {mediaPinEligible && (
          <div ref={mediaSentinelRef} aria-hidden="true" className="h-px md:hidden" />
        )}
        <div className={`mx-auto ${innerWidth} ${horizPad} pb-16 pt-6`}>
          {/* Failed-ingestion banner: lives in the scrollable content
              area so its presence/absence never bumps the sticky
              header. Click "Retry" → it disappears and the skeleton
              below takes over while the new run finishes. */}
          {card.status === "failed" && card.error_message && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-red-200">
                  {t("card.ingestionFailed", { defaultValue: "Ingestion failed" })}
                </p>
                <p className="mt-1 break-words text-xs text-red-300/80">{card.error_message}</p>
              </div>
              {canRegenerate && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="flex-shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-500/20"
                >
                  {t("card.retry")}
                </button>
              )}
            </div>
          )}

          {/* While the card is being processed, show the animated
              skeleton in place of the tabs' empty bodies. The polling
              poll in LibraryPage refreshes the card object so we flip
              back to the real layout once status === completed. */}
          {(card.status === "queued" || card.status === "processing") ? (
            <IngestionSkeleton
              status={card.status}
              thumbnailUrl={card.thumbnail_url}
              title={card.title}
              variant="full"
            />
          ) : (
          <div key={tab} className="tab-content-enter">
            {tab === "summary" && (
              <SummaryTab card={card} activeTranslation={activeTranslation} />
            )}

            {tab === "transcript" && (
              <TranscriptTab
                transcript={transcript}
                youtubeVideoId={
                  card.source_type === "youtube" ? card.external_id ?? null : null
                }
                youtubeUrl={card.source_url ?? null}
              />
            )}

            {tab === "notes" && (
              <NotesTab
                value={notes}
                onChange={setNotes}
                onSave={saveNotes}
                saving={savingNotes}
                showPublicHint={card.is_public}
              />
            )}

            {tab === "quiz" && <QuizTab quiz={quiz} cardStatus={card.status} />}

            {tab === "chat" && (
              <ChatTab
                card={card}
                showSourceMedia
                onNotesExported={(nextNotes) => {
                  setCard((prev) => (prev ? { ...prev, notes_md: nextNotes } : prev));
                  setNotes(nextNotes);
                }}
              />
            )}

            {tab === "related" && (
              <RelatedTab
                cardId={card.id}
                onPick={(id) => navigate(`/cards/${id}`)}
              />
            )}

            {tab === "highlights" && (
              <HighlightsTab
                cardId={card.id}
                sourceUrl={card.source_url ?? null}
              />
            )}

            {tab === "graph" && (
              <div className="h-[65vh]">
                <CardGraph
                  rootCardId={card.id}
                  rootTitle={card.title}
                  rootSourceType={card.source_type}
                />
              </div>
            )}

            {tab === "podcast" && <CardPodcastPlayer cardId={card.id} />}

            {tab === "posts" && <PostsTab cardId={card.id} />}
          </div>
          )}
        </div>
      </div>
      <ShareModal cardId={shareOpen ? cardId : null} onClose={() => setShareOpen(false)} />
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function ActionBar({
  canRegenerate,
  onRegenerate,
  canReingest,
  onReingest,
  onDownload,
  onCopyMarkdown,
  onCopyPlain,
  onDownloadOriginal,
  onShare,
  onDelete,
  sourceUrl,
  t,
}: {
  canRegenerate: boolean;
  onRegenerate: () => void;
  /** When true (= card is in a completed state) show a circular-arrow
   *  button that re-runs the whole ingestion pipeline. Distinct from
   *  Retry because it overwrites a working summary and therefore
   *  prompts for confirmation in the parent. */
  canReingest?: boolean;
  onReingest?: () => void;
  onDownload: (e: React.MouseEvent) => void;
  onCopyMarkdown: () => Promise<void>;
  onCopyPlain: () => Promise<void>;
  onDownloadOriginal?: () => Promise<void> | void;
  onShare: () => void;
  onDelete: () => void;
  /** Original URL of the card's source (e.g. the GitHub repo, the
   *  YouTube watch URL). When set, an "Open original" link button
   *  appears in the action bar. Hidden for note-only cards. */
  sourceUrl?: string | null;
  t: (key: string, opts?: { defaultValue?: string }) => string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-ink-800 bg-ink-800/40 p-1">
      {canRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          title={t("card.retry")}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-200 transition hover:bg-ink-700"
        >
          <RefreshCw className="h-3 w-3" />
          <span className="hidden sm:inline">{t("card.retry")}</span>
        </button>
      )}
      {canReingest && onReingest && (
        <button
          type="button"
          onClick={onReingest}
          title={t("card.reingest", { defaultValue: "Neu einlesen" })}
          aria-label={t("card.reingest", { defaultValue: "Neu einlesen" })}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      )}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t("card.openSource", { defaultValue: "Open original source" })}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-200 transition hover:bg-ink-700"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="hidden sm:inline">
            {t("card.openSourceShort", { defaultValue: "Open" })}
          </span>
        </a>
      )}
      <ExportMenu
        onDownload={onDownload}
        onCopyMarkdown={onCopyMarkdown}
        onCopyPlain={onCopyPlain}
        onDownloadOriginal={onDownloadOriginal}
        t={t}
      />
      <button
        type="button"
        onClick={onShare}
        title={t("share.title")}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-200 transition hover:bg-ink-700"
      >
        <Share2 className="h-3 w-3" />
        <span className="hidden sm:inline">{t("share.title")}</span>
      </button>
      <span className="mx-1 h-4 w-px bg-ink-700" />
      <button
        type="button"
        onClick={onDelete}
        title={t("common.delete")}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-400 transition hover:bg-red-500/15 hover:text-red-400"
        aria-label={t("common.delete")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ExportMenu({
  onDownload,
  onCopyMarkdown,
  onCopyPlain,
  onDownloadOriginal,
  t,
}: {
  onDownload: (e: React.MouseEvent) => void;
  onCopyMarkdown: () => Promise<void>;
  onCopyPlain: () => Promise<void>;
  onDownloadOriginal?: () => Promise<void> | void;
  t: (key: string, opts?: { defaultValue?: string }) => string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"md" | "txt" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + ESC
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fire = async (kind: "md" | "txt") => {
    if (kind === "md") await onCopyMarkdown();
    else await onCopyPlain();
    setCopied(kind);
    setOpen(false);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("card.export.menu", { defaultValue: "Export" })}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-200 transition hover:bg-ink-700"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Download className="h-3 w-3" />}
        <span className="hidden sm:inline">
          {copied === "md"
            ? t("card.export.copiedMd", { defaultValue: "MD copied" })
            : copied === "txt"
            ? t("card.export.copiedTxt", { defaultValue: "Text copied" })
            : t("card.exportMarkdown")}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-md border border-ink-700 bg-ink-800 surface-elevated modal-card-enter">
          <MenuItem
            Icon={Copy}
            label={t("card.export.copyMd", { defaultValue: "Copy markdown" })}
            onClick={() => void fire("md")}
          />
          <MenuItem
            Icon={Type}
            label={t("card.export.copyText", { defaultValue: "Copy plain text" })}
            onClick={() => void fire("txt")}
          />
          <div className="my-0.5 border-t border-ink-700" />
          <MenuItem
            Icon={Download}
            label={t("card.export.downloadMd", { defaultValue: "Download .md" })}
            onClick={(e) => {
              onDownload(e);
              setOpen(false);
            }}
          />
          {onDownloadOriginal && (
            <>
              <div className="my-0.5 border-t border-ink-700" />
              <MenuItem
                Icon={FileText}
                label={t("card.export.downloadOriginal", { defaultValue: "Download original file" })}
                onClick={() => {
                  void onDownloadOriginal();
                  setOpen(false);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  onClick,
}: {
  Icon: typeof Copy;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-200 transition hover:bg-ink-700/60"
    >
      <Icon className="h-3.5 w-3.5 text-ink-400" />
      {label}
    </button>
  );
}


/* ----------------------------------------------------------------------
 * Tab-strip chevron — desktop-only paging button on either side of the
 * horizontal scroller. Hidden on touch viewports (mobile already pans
 * the strip with a finger). Hidden when the scroll is already pinned
 * to the matching edge.
 * -------------------------------------------------------------------- */
function TabScrollChevron({
  direction,
  scrollerRef,
}: {
  direction: "left" | "right";
  scrollerRef: React.RefObject<HTMLDivElement>;
}) {
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) {
        setCanScroll(false);
        return;
      }
      if (direction === "left") {
        setCanScroll(el.scrollLeft > 1);
      } else {
        setCanScroll(el.scrollLeft < max - 1);
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [direction, scrollerRef]);

  const onClick = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(120, el.clientWidth * 0.6);
    el.scrollBy({ left: direction === "left" ? -step : step, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "left" ? "Scroll tabs left" : "Scroll tabs right"}
      className={[
        "hidden h-7 w-6 flex-shrink-0 items-center justify-center rounded text-ink-400 transition md:inline-flex",
        canScroll ? "hover:bg-ink-800 hover:text-ink-200" : "invisible",
      ].join(" ")}
      tabIndex={canScroll ? 0 : -1}
    >
      {direction === "left" ? (
        <ChevronLeft className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
    </button>
  );
}
