import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  Hash,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  Share2,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

import CardGraph from "./CardGraph";
import ChatPanel from "./ChatPanel";
import ShareModal from "./ShareModal";
import StatusBadge from "./StatusBadge";
import { useDialog } from "../lib/DialogContext";
import { api, type Card, type QuizQuestion } from "../lib/api";

export type CardDetailTab =
  | "summary"
  | "transcript"
  | "notes"
  | "quiz"
  | "chat"
  | "graph";

const TAB_ICONS: Record<CardDetailTab, FC<{ className?: string }>> = {
  summary: BookOpen,
  transcript: FileText,
  notes: StickyNote,
  quiz: Sparkles,
  chat: MessageSquare,
  graph: Network,
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
}

export default function CardDetailContent({
  cardId,
  onBack,
  backStyle = "link",
  compact = false,
  initialTab = "summary",
  hideChatTab = false,
}: Props) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [shareOpen, setShareOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<CardDetailTab>(initialTab);
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
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId]);

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
  const allTabs: CardDetailTab[] = ["summary", "transcript", "notes", "quiz", "chat", "graph"];
  const tabs = hideChatTab ? allTabs.filter((id) => id !== "chat") : allTabs;
  const tagPills = card.key_takeaways_json && card.key_takeaways_json.length > 0;
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
                </div>
                <h1 className="text-lg font-semibold leading-tight tracking-tight text-ink-100">
                  {card.title}
                </h1>
                {card.error_message && (
                  <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">
                    {card.error_message}
                  </p>
                )}
              </div>
            </div>

            <ActionBar
              canRegenerate={canRegenerate}
              onRegenerate={handleRegenerate}
              onDownload={downloadMarkdown}
              onShare={() => setShareOpen(true)}
              onDelete={handleDelete}
              t={t}
            />
          </header>

          {(card.status === "queued" || card.status === "processing") && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t(`card.status.${card.status}`)}…
            </div>
          )}
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
          <div key={tab} className="tab-content-enter">
            {tab === "summary" && (
              <div className="space-y-8 text-sm leading-relaxed">
                {card.concise_summary_md && (
                  <Section icon={BookOpen} label="TL;DR">
                    <p className="text-base text-ink-100/90">{card.concise_summary_md}</p>
                  </Section>
                )}

                {tagPills && (
                  <Section icon={Sparkles} label={t("card.summary") + " — Key Takeaways"}>
                    <ul className="grid gap-2 md:grid-cols-2">
                      {card.key_takeaways_json!.map((point, idx) => (
                        <li
                          key={idx}
                          className="group flex items-start gap-2 rounded-md border border-ink-800 bg-ink-800/40 p-3 text-ink-200 transition hover:border-ink-700 hover:bg-ink-800/70"
                        >
                          <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 transition group-hover:bg-ink-200" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {card.detailed_summary_md && (
                  <Section icon={FileText} label={t("card.summary")}>
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink-200">
                      {card.detailed_summary_md}
                    </pre>
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
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={18}
                  className="w-full resize-y rounded-lg border border-ink-700 bg-ink-900 p-4 font-mono text-sm leading-relaxed text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
                  placeholder="# Notizen in Markdown …"
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
                    —
                  </p>
                ) : (
                  quiz.map((q, i) => <QuizCard key={q.id} index={i + 1} question={q} />)
                )}
              </div>
            )}

            {tab === "chat" && (
              <div className="h-[60vh]">
                <ChatPanel
                  send={(history) => api.chatCard(cardId, history)}
                  placeholder={t("chat.placeholderCard") ?? ""}
                  emptyHint={t("chat.cardEmpty") ?? ""}
                />
              </div>
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
  onShare,
  onDelete,
  t,
}: {
  canRegenerate: boolean;
  onRegenerate: () => void;
  onDownload: (e: React.MouseEvent) => void;
  onShare: () => void;
  onDelete: () => void;
  t: (key: string) => string;
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
      <button
        type="button"
        onClick={onDownload}
        title={t("card.exportMarkdown")}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-200 transition hover:bg-ink-700"
      >
        <Download className="h-3 w-3" />
        <span className="hidden sm:inline">{t("card.exportMarkdown")}</span>
      </button>
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

function QuizCard({ index, question }: { index: number; question: QuizQuestion }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="group rounded-lg border border-ink-800 bg-ink-800/50 p-4 text-sm transition hover:border-ink-700">
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
              Reveal
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
