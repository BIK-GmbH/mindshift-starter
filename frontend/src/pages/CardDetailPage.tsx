import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import ChatPanel from "../components/ChatPanel";
import StatusBadge from "../components/StatusBadge";
import { api, type Card, type QuizQuestion } from "../lib/api";

type Tab = "summary" | "transcript" | "notes" | "quiz" | "chat";

export default function CardDetailPage() {
  const { t } = useTranslation();
  const { cardId = "" } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
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
    if (!confirm(t("common.delete") + "?")) return;
    await api.deleteCard(cardId);
    navigate("/");
  };

  if (!card) {
    return (
      <div className="p-8 text-sm text-ink-300">
        {error ? <p className="text-red-400">{error}</p> : t("common.loading")}
      </div>
    );
  }

  const tabs: { id: Tab; key: string }[] = [
    { id: "summary", key: "card.summary" },
    { id: "transcript", key: "card.transcript" },
    { id: "notes", key: "card.notes" },
    { id: "quiz", key: "card.quiz" },
    { id: "chat", key: "card.chat" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="mb-4 inline-flex items-center gap-1 text-xs text-ink-300 hover:text-ink-100"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("nav.library")}
      </button>

      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="flex flex-1 items-start gap-4">
          {card.thumbnail_url && (
            <img src={card.thumbnail_url} alt="" className="h-20 w-32 rounded object-cover" />
          )}
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <StatusBadge status={card.status} />
              <span className="text-[10px] uppercase tracking-wide text-ink-400">
                {card.source_type}
              </span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{card.title}</h1>
            {card.error_message && (
              <p className="mt-1 text-xs text-red-400">{card.error_message}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="text-ink-400 hover:text-red-400"
          aria-label={t("common.delete") ?? ""}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {(card.status === "queued" || card.status === "processing") && (
        <div className="mb-4 flex items-center gap-2 rounded border border-ink-700 bg-ink-800 p-3 text-xs text-ink-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t(`card.status.${card.status}`)}…
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-ink-700 text-sm">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={[
              "border-b-2 px-3 py-2 transition",
              tab === tabItem.id
                ? "border-ink-100 text-ink-100"
                : "border-transparent text-ink-300 hover:text-ink-100",
            ].join(" ")}
          >
            {t(tabItem.key)}
          </button>
        ))}
      </nav>

      <div>
        {tab === "summary" && (
          <div className="space-y-4 text-sm leading-relaxed">
            {card.concise_summary_md ? (
              <section>
                <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-400">TL;DR</h2>
                <p>{card.concise_summary_md}</p>
              </section>
            ) : null}
            {card.key_takeaways_json && card.key_takeaways_json.length > 0 && (
              <section>
                <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-400">Key takeaways</h2>
                <ul className="list-inside list-disc space-y-1 text-ink-200">
                  {card.key_takeaways_json.map((point, idx) => (
                    <li key={idx}>{point}</li>
                  ))}
                </ul>
              </section>
            )}
            {card.detailed_summary_md ? (
              <section>
                <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-400">
                  {t("card.summary")}
                </h2>
                <pre className="whitespace-pre-wrap font-sans text-ink-100">
                  {card.detailed_summary_md}
                </pre>
              </section>
            ) : null}
          </div>
        )}

        {tab === "transcript" && (
          <div className="text-sm leading-relaxed">
            {transcript === null ? (
              <p className="text-ink-300">{t("common.loading")}</p>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-ink-200">{transcript}</pre>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="space-y-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={14}
              className="w-full rounded border border-ink-600 bg-ink-900 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
              placeholder="Markdown notes…"
            />
            <button
              type="button"
              onClick={saveNotes}
              disabled={savingNotes}
              className="inline-flex items-center gap-2 rounded bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 hover:bg-ink-200 disabled:opacity-60"
            >
              {savingNotes && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        )}

        {tab === "quiz" && (
          <div className="space-y-3">
            {quiz.length === 0 ? (
              <p className="text-sm text-ink-300">—</p>
            ) : (
              quiz.map((q) => <QuizCard key={q.id} question={q} />)
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
      </div>
    </div>
  );
}

function QuizCard({ question }: { question: QuizQuestion }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded border border-ink-700 bg-ink-800 p-3 text-sm">
      <p className="font-medium">{question.question}</p>
      {revealed ? (
        <p className="mt-2 text-ink-200">{question.answer}</p>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-2 text-xs text-ink-300 underline hover:text-ink-100"
        >
          Reveal
        </button>
      )}
    </div>
  );
}
