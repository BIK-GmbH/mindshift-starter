import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Hash,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
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

import CardGraph from "./CardGraph";
import CardLanguagePicker from "./CardLanguagePicker";
import CardPodcastPlayer from "./CardPodcastPlayer";
import CardSourceMedia from "./CardSourceMedia";
import CardTagsBar from "./CardTagsBar";
import ChatPanel from "./ChatPanel";
import MarkdownView, { markdownToPlainText } from "./MarkdownView";
import RichTextEditor from "./RichTextEditor";
import ShareModal from "./ShareModal";
import StatusBadge from "./StatusBadge";
import { useDialog } from "../lib/DialogContext";
import { api, type Card, type CardTranslationOut, type QuizQuestion } from "../lib/api";
import { emit } from "../lib/events";

export type CardDetailTab =
  | "summary"
  | "transcript"
  | "notes"
  | "quiz"
  | "chat"
  | "graph"
  | "podcast";

const TAB_ICONS: Record<CardDetailTab, FC<{ className?: string }>> = {
  summary: BookOpen,
  transcript: FileText,
  notes: StickyNote,
  quiz: Sparkles,
  chat: MessageSquare,
  graph: Network,
  podcast: Headphones,
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
  const [shareOpen, setShareOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [activeTranslation, setActiveTranslation] = useState<CardTranslationOut | null>(null);
  const [tab, setTab] = useState<CardDetailTab>(initialTab);
  // Source-media panel toggle. Off by default so the tab strip and
  // content stay uncluttered; user enables it via the eye button next
  // to the tabs whenever they want the video / repo card visible.
  const [showPlayer, setShowPlayer] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (tab === "transcript" && transcript === null && card?.status === "completed") {
      void api
        .getTranscript(cardId)
        .then((res) => setTranscript(res.text))
        .catch((err) => setTranscript(`${(err as Error).message}`));
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
  const allTabs: CardDetailTab[] = ["summary", "transcript", "notes", "quiz", "chat", "graph", "podcast"];
  const tabs = hideChatTab ? allTabs.filter((id) => id !== "chat") : allTabs;
  const horizPad = compact ? "px-5" : "px-8";
  const innerWidth = compact ? "max-w-none" : "max-w-4xl";

  return (
    <div className="flex h-full flex-col">
      {/* Sticky top region */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className={`mx-auto ${innerWidth} ${horizPad} pb-2 pt-5`}>
          {backStyle === "link" ? (
            <button
              type="button"
              onClick={onBack}
              className="group inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400 transition hover:text-ink-100"
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

          <header className="mt-3 flex items-start justify-between gap-5">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              {card.thumbnail_url ? (
                <img
                  src={card.thumbnail_url}
                  alt=""
                  className="h-20 w-32 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
                />
              ) : (
                <div className="flex h-20 w-32 flex-shrink-0 items-center justify-center rounded-md bg-ink-800 ring-1 ring-ink-700">
                  <Type className="h-5 w-5 text-ink-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
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
                <h1 className="text-lg font-semibold leading-tight tracking-tight text-ink-100">
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

            <ActionBar
              canRegenerate={canRegenerate}
              onRegenerate={handleRegenerate}
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
                // Hide for note-only cards (the URL is just an internal
                // note:// pseudo-URL) and for anything else without a
                // proper http(s) source.
                card.source_type !== "note" &&
                card.source_url &&
                /^https?:\/\//i.test(card.source_url)
                  ? card.source_url
                  : null
              }
              t={t}
            />
          </header>
        </div>

        <div className={`mx-auto ${innerWidth} ${horizPad}`}>
          <nav className="no-scrollbar flex gap-0.5 overflow-x-auto" aria-label="card sections">
            {tabs.map((id) => {
              const Icon = TAB_ICONS[id];
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={[
                    "group relative inline-flex items-center gap-1.5 px-3 pb-3 pt-2 text-sm transition-colors",
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
          </nav>
        </div>
      </div>

      {/* Scrolling content */}
      <div className="flex-1 overflow-y-auto">
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

          <div key={tab} className="tab-content-enter">
            {tab === "summary" && (
              <div className="space-y-8 text-sm leading-relaxed">
                {(activeTranslation?.concise_summary_md ?? card.concise_summary_md) && (
                  <Section icon={BookOpen} label={t("card.tldr", { defaultValue: "TL;DR" })}>
                    <p className="text-base text-ink-100/90">
                      {activeTranslation?.concise_summary_md ?? card.concise_summary_md}
                    </p>
                  </Section>
                )}

                {(() => {
                  const takeaways =
                    activeTranslation?.key_takeaways_json ?? card.key_takeaways_json ?? [];
                  if (takeaways.length === 0) return null;
                  return (
                    <Section icon={Sparkles} label={t("card.summary") + " — Key Takeaways"}>
                      <ul className="grid gap-2 md:grid-cols-2">
                        {takeaways.map((point, idx) => (
                          <li
                            key={idx}
                            className="surface-soft group flex items-start gap-2 rounded-md border border-transparent bg-ink-800/40 p-3 text-ink-200 transition hover:bg-ink-800/70"
                          >
                            <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 transition group-hover:bg-ink-200" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  );
                })()}

                {(activeTranslation?.detailed_summary_md ?? card.detailed_summary_md) && (
                  <Section icon={FileText} label={t("card.summary")}>
                    <MarkdownView
                      source={
                        activeTranslation?.detailed_summary_md ?? card.detailed_summary_md ?? ""
                      }
                    />
                  </Section>
                )}
              </div>
            )}

            {tab === "transcript" && (
              <div className="text-sm leading-relaxed">
                {transcript === null ? (
                  <SkeletonLines />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink-200">
                    {transcript}
                  </pre>
                )}
              </div>
            )}

            {tab === "notes" && (
              <div className="space-y-3">
                {card.is_public && (
                  <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-300">
                    <Globe className="h-3 w-3" />
                    {t("card.publicEditHint", {
                      defaultValue:
                        "Heads up — this card is reachable via a public tag. Edits go live immediately.",
                    })}
                  </p>
                )}
                <RichTextEditor
                  markdown={notes}
                  onChange={setNotes}
                  placeholder={t("card.notesPlaceholder", {
                    defaultValue: "Write your notes here — bold, lists, headings, links",
                  })}
                  minHeight={360}
                />
                <div className="flex items-center justify-between text-xs text-ink-400">
                  <span>{notes.length} chars</span>
                  <button
                    type="button"
                    onClick={saveNotes}
                    disabled={savingNotes}
                    className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-60"
                  >
                    {savingNotes && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t("common.save")}
                  </button>
                </div>
              </div>
            )}

            {tab === "quiz" && (
              <div className="space-y-3">
                {quiz.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-ink-400">
                    {card.status === "completed"
                      ? t("card.quiz.empty", {
                          defaultValue: "No quiz questions for this card.",
                        })
                      : t("card.quiz.processing", {
                          defaultValue: "Quiz will appear once the card finishes processing.",
                        })}
                  </p>
                ) : (
                  quiz.map((q, i) => <QuizCard key={q.id} index={i + 1} question={q} t={t} />)
                )}
              </div>
            )}

            {tab === "chat" && (() => {
              const hasMedia =
                card.source_type === "youtube" && !!card.external_id;
              const playerOpen = hasMedia && showPlayer;
              return (
                <div
                  className="flex flex-col gap-3"
                  style={{ height: "min(80vh, 900px)" }}
                >
                  {hasMedia && (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setShowPlayer((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/50 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
                      >
                        {playerOpen ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        {playerOpen
                          ? t("cardSource.hidePlayer", { defaultValue: "Hide video" })
                          : t("cardSource.showPlayer", { defaultValue: "Show video" })}
                      </button>
                    </div>
                  )}
                  {/* Player and chat split the remaining height 50/50
                      via flex-1 + min-h-0; the player overrides its
                      default 16:9 ratio with fitHeight so it grows to
                      match the chat. */}
                  {playerOpen && (
                    <div className="min-h-0 flex-1">
                      <CardSourceMedia card={card} fitHeight />
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ChatPanel
                      send={(history) => api.chatCard(cardId, history)}
                      placeholder={t("chat.placeholderCard") ?? ""}
                      emptyHint={t("chat.cardEmpty") ?? ""}
                    />
                  </div>
                </div>
              );
            })()}

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
          </div>
        </div>
      </div>
      <ShareModal cardId={shareOpen ? cardId : null} onClose={() => setShareOpen(false)} />
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: FC<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      {children}
    </section>
  );
}

function ActionBar({
  canRegenerate,
  onRegenerate,
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

function QuizCard({ index, question, t }: { index: number; question: QuizQuestion; t: (k: string) => string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="surface-soft group rounded-lg border border-transparent bg-ink-800/50 p-4 text-sm transition">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold text-ink-200">
          {index}
        </span>
        <div className="flex-1">
          <p className="font-medium leading-snug text-ink-100">{question.question}</p>
          {revealed ? (
            <p className="mt-3 rounded-md bg-ink-900/60 p-3 text-ink-200 ring-1 ring-ink-700">
              {question.answer}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-300 transition hover:text-ink-100"
            >
              <Hash className="h-3 w-3" />
              {t("card.reveal")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonLines() {
  return (
    <div className="space-y-2">
      {[100, 95, 88, 92, 70, 96, 60].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-ink-800/70"
          style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
