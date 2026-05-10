import { BookOpen, FileText, Loader2, MessageSquare, Sparkles, StickyNote } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

import CardSourceMedia from "./CardSourceMedia";
import IngestionSkeleton from "./IngestionSkeleton";
import ChatTab from "./cardTabs/ChatTab";
import NotesTab from "./cardTabs/NotesTab";
import QuizTab from "./cardTabs/QuizTab";
import SummaryTab from "./cardTabs/SummaryTab";
import TranscriptTab from "./cardTabs/TranscriptTab";
import { api, type Card, type QuizQuestion, type TranscriptOut } from "../lib/api";

type PlayerTab = "summary" | "transcript" | "quiz" | "notes" | "chat";

const TAB_ICONS: Record<PlayerTab, FC<{ className?: string }>> = {
  summary: BookOpen,
  transcript: FileText,
  quiz: Sparkles,
  notes: StickyNote,
  chat: MessageSquare,
};

interface PathPlayerCardViewProps {
  cardId: string;
}

export default function PathPlayerCardView({ cardId }: PathPlayerCardViewProps) {
  const { t } = useTranslation();
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<PlayerTab>("summary");
  const [transcript, setTranscript] = useState<TranscriptOut | null>(null);
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

  // Reset transient state when the card changes (path player swaps cards
  // by remounting via `key={card_id}`, but defending here keeps it correct
  // if a parent ever passes a changing `cardId` without remount).
  useEffect(() => {
    setTab("summary");
    setTranscript(null);
    setQuiz([]);
  }, [cardId]);

  // Re-poll while ingestion is still running.
  useEffect(() => {
    if (!card) return;
    if (card.status === "completed" || card.status === "failed") return;
    const handle = window.setInterval(() => void fetchCard(), 2500);
    return () => window.clearInterval(handle);
  }, [card, fetchCard]);

  // Lazy fetch per active tab.
  useEffect(() => {
    if (!card || card.status !== "completed") return;
    if (tab === "transcript" && transcript === null) {
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
    if (tab === "quiz" && quiz.length === 0) {
      void api.getQuiz(cardId).then(setQuiz).catch(() => undefined);
    }
  }, [tab, cardId, transcript, quiz.length, card]);

  const saveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const updated = await api.updateNotes(cardId, notes);
      setCard(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }, [cardId, notes]);

  const tabs = useMemo<PlayerTab[]>(
    () => ["summary", "transcript", "quiz", "notes", "chat"],
    []
  );

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-300">
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </span>
        )}
      </div>
    );
  }

  const hasMedia =
    (card.source_type === "youtube" && !!card.external_id) ||
    card.source_type === "pdf" ||
    card.source_type === "url" ||
    card.source_type === "github";

  return (
    <div className="flex h-full flex-col">
      {/* Auto-shown source media — full content width, 16:9 for YouTube,
          natural sizing for other source types. */}
      {hasMedia && (
        <div className="flex-shrink-0 border-b border-ink-800 bg-ink-950/40">
          <div className="mx-auto max-w-5xl px-4 py-4">
            <CardSourceMedia card={card} />
          </div>
        </div>
      )}

      {/* Tab strip */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <nav className="no-scrollbar mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-4" aria-label="card sections">
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

      {/* Active tab body — scrolls within the player frame */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-6">
          {(card.status === "queued" || card.status === "processing") ? (
            <IngestionSkeleton
              status={card.status}
              thumbnailUrl={card.thumbnail_url}
              title={card.title}
              variant="full"
            />
          ) : (
            <div key={tab} className="tab-content-enter">
              {tab === "summary" && <SummaryTab card={card} activeTranslation={null} />}
              {tab === "transcript" && (
                <TranscriptTab
                  transcript={transcript}
                  youtubeVideoId={
                    card.source_type === "youtube" ? card.external_id ?? null : null
                  }
                  youtubeUrl={card.source_url ?? null}
                />
              )}
              {tab === "quiz" && <QuizTab quiz={quiz} cardStatus={card.status} />}
              {tab === "notes" && (
                <NotesTab
                  value={notes}
                  onChange={setNotes}
                  onSave={saveNotes}
                  saving={savingNotes}
                  showPublicHint={card.is_public}
                />
              )}
              {tab === "chat" && <ChatTab card={card} showSourceMedia={false} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
