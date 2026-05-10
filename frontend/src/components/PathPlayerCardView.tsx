import { BookOpen, FileText, Loader2, Maximize2, MessageSquare, Sparkles, StickyNote } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
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

type PathPlayerMode = { kind: "owner" } | { kind: "public"; username: string; slug: string };

interface PathPlayerCardViewProps {
  cardId: string;
  mode?: PathPlayerMode; // defaults to { kind: "owner" }
}

export default function PathPlayerCardView({ cardId, mode }: PathPlayerCardViewProps) {
  const playerMode: PathPlayerMode = mode ?? { kind: "owner" };
  const { t } = useTranslation();
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<PlayerTab>("summary");
  const [transcript, setTranscript] = useState<TranscriptOut | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mini-player state. When the user scrolls past the auto-shown source
  // media, the YouTube embed shrinks and pins to the top-right corner of
  // the viewport so the user can keep watching while reading the tabs
  // below. Only enabled for YouTube cards on viewports >= 768 px.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(false);

  const fetchCard = useCallback(async () => {
    try {
      if (playerMode.kind === "owner") {
        const data = await api.getCard(cardId);
        setCard(data);
        setNotes(data.notes_md ?? "");
      } else {
        const data = await api.getPublicPathCard(playerMode.username, playerMode.slug, cardId);
        // Adapt the PublicCardOut to the Card shape the tabs expect.
        setCard({
          ...data,
          user_id: "",
          source_id: null,
          original_file_id: null,
          notes_md: null,
          error_message: null,
          is_public: true,
          public_via_tags: [],
          tags: [],
          updated_at: data.created_at,
        } as unknown as Card);
        setNotes("");
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId, playerMode]);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  useEffect(() => {
    setTab("summary");
    setTranscript(null);
    setQuiz([]);
    setIsPinned(false);
  }, [cardId]);

  useEffect(() => {
    if (!card) return;
    if (card.status === "completed" || card.status === "failed") return;
    const handle = window.setInterval(() => void fetchCard(), 2500);
    return () => window.clearInterval(handle);
  }, [card, fetchCard]);

  useEffect(() => {
    if (!card || card.status !== "completed") return;
    if (tab === "transcript" && transcript === null) {
      const fetcher =
        playerMode.kind === "owner"
          ? api.getTranscript(cardId)
          : api.getPublicPathCardTranscript(playerMode.username, playerMode.slug, cardId);
      void fetcher
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
      const fetcher =
        playerMode.kind === "owner"
          ? api.getQuiz(cardId)
          : api.getPublicPathCardQuiz(playerMode.username, playerMode.slug, cardId);
      void fetcher.then(setQuiz).catch(() => undefined);
    }
  }, [tab, cardId, transcript, quiz.length, card, playerMode]);

  const saveNotes = useCallback(async () => {
    if (playerMode.kind !== "owner") return;
    setSavingNotes(true);
    try {
      const updated = await api.updateNotes(cardId, notes);
      setCard(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }, [cardId, notes, playerMode]);

  const tabs = useMemo<PlayerTab[]>(
    () =>
      playerMode.kind === "public"
        ? ["summary", "transcript", "quiz"]
        : ["summary", "transcript", "quiz", "notes", "chat"],
    [playerMode.kind],
  );

  // PDF readers, URL previews and repo cards aren't useful as floating
  // thumbnails — the mini-player is YouTube-only.
  const pinningEligible = card?.source_type === "youtube" && !!card?.external_id;

  useEffect(() => {
    if (!pinningEligible) {
      setIsPinned(false);
      return;
    }
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;

    const desktopQuery = window.matchMedia("(min-width: 768px)");
    let observer: IntersectionObserver | null = null;
    const enable = () => {
      observer = new IntersectionObserver(
        ([entry]) => setIsPinned(!entry.isIntersecting),
        { root, threshold: 0 },
      );
      observer.observe(sentinel);
    };
    const disable = () => {
      observer?.disconnect();
      observer = null;
      setIsPinned(false);
    };
    if (desktopQuery.matches) enable();
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) enable();
      else disable();
    };
    desktopQuery.addEventListener("change", onChange);
    return () => {
      observer?.disconnect();
      desktopQuery.removeEventListener("change", onChange);
    };
  }, [pinningEligible]);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
      {/* Single scroll region — source-media + sticky tab strip + tab
          content all live here. The sticky tab strip stays visible as
          the user scrolls past the source-media; for YouTube cards an
          IntersectionObserver on the sentinel below the source-media
          flips the embed into a fixed top-right mini-player. */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {hasMedia && (
          <div className="border-b border-ink-800 bg-ink-950/40">
            <div className="mx-auto max-w-5xl px-4 py-4">
              {/* aspect-video reservation: keeps the 16:9 space in flow
                  even when the inner element pins to the corner — this
                  prevents the layout below from jumping. */}
              <div className="relative aspect-video">
                <div
                  className={[
                    "overflow-hidden rounded-md ring-1 transition-all duration-300 ease-out",
                    isPinned
                      ? "fixed right-4 top-24 z-30 aspect-video w-80 shadow-2xl ring-ink-700"
                      : "absolute inset-0 ring-transparent",
                  ].join(" ")}
                >
                  <CardSourceMedia card={card} />
                  {isPinned && (
                    <button
                      type="button"
                      onClick={scrollToTop}
                      title={t("paths.maximizeVideo", { defaultValue: "Maximize" }) ?? ""}
                      aria-label={t("paths.maximizeVideo", { defaultValue: "Maximize" }) ?? ""}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/85 text-ink-200 transition hover:bg-ink-800 hover:text-ink-100"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sentinel — when this scrolls out of view at the container top,
            the embed pins. Only rendered when pinning is eligible. */}
        {pinningEligible && (
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        )}

        {/* Tab strip — sticky inside the scroll container so it stays
            visible after the user has scrolled past the source-media. */}
        <div className="sticky top-0 z-20 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
          <nav
            className="no-scrollbar mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-4"
            aria-label="card sections"
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

        {/* Active tab body */}
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
              {playerMode.kind === "owner" && tab === "notes" && (
                <NotesTab
                  value={notes}
                  onChange={setNotes}
                  onSave={saveNotes}
                  saving={savingNotes}
                  showPublicHint={card.is_public}
                />
              )}
              {playerMode.kind === "owner" && tab === "chat" && (
                <ChatTab card={card} showSourceMedia={false} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
