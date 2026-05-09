import { ArrowLeft, ArrowRight, Check, ChevronLeft, Loader2, RotateCw, Sparkles, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import MobileDesktopHint from "../components/MobileDesktopHint";
import { api, type PathQuiz, type PathQuizQuestion, type QuizStats } from "../lib/api";

type Phase = "loading" | "ready" | "answering" | "showing-answer" | "done" | "empty";

interface AnswerRecord {
  questionId: string;
  selfRated: "correct" | "wrong";
}

/**
 * Path-wide quiz mode. Pulls every quiz question from every card in
 * the path, shuffles them, walks through them one-by-one. The user
 * self-rates each answer (we don't try to grade open-text answers
 * automatically — the existing review flow uses the same pattern).
 *
 * Multiple-choice questions (questions with choices_json populated)
 * render their choices and grade automatically. Open-text questions
 * reveal the model answer and let the user self-rate.
 *
 * Score is in-memory only — we deliberately don't persist a "quiz
 * attempt" entity in the MVP. The card-level review-event flow keeps
 * spaced-repetition state separate from path-mode quizzing.
 */
export default function PathQuizPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathId = "" } = useParams<{ pathId: string }>();
  const [quiz, setQuiz] = useState<PathQuiz | null>(null);
  const [questions, setQuestions] = useState<PathQuizQuestion[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  // For MC questions — the choice the user clicked, before reveal.
  const [pickedChoice, setPickedChoice] = useState<string | null>(null);
  const [stats, setStats] = useState<QuizStats | null>(null);
  // Persist start time so we can submit duration on completion. Uses
  // a ref because a state update would re-render the timer needlessly.
  const startedAtRef = useRef<number>(Date.now());
  const submittedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const [q, s] = await Promise.all([
          api.getPathQuiz(pathId),
          api.getQuizStats(pathId).catch(() => null),
        ]);
        setQuiz(q);
        setStats(s);
        if (q.questions.length === 0) {
          setPhase("empty");
        } else {
          setQuestions(shuffle(q.questions));
          startedAtRef.current = Date.now();
          submittedRef.current = false;
          setPhase("answering");
        }
      } catch (err) {
        setError((err as Error).message);
        setPhase("ready");
      }
    })();
  }, [pathId]);

  const current = questions[index] ?? null;
  const isMC = !!(current?.choices_json && current.choices_json.length > 0);
  const total = questions.length;

  const score = useMemo(
    () => answers.filter((a) => a.selfRated === "correct").length,
    [answers],
  );

  const reveal = (rating?: "correct" | "wrong") => {
    if (!current) return;
    if (rating) {
      setAnswers((prev) => [...prev, { questionId: current.id, selfRated: rating }]);
    }
    setPhase("showing-answer");
  };

  const next = () => {
    setPickedChoice(null);
    if (index + 1 >= total) {
      setPhase("done");
    } else {
      setIndex(index + 1);
      setPhase("answering");
    }
  };

  // Persist the attempt the moment we transition to "done". Guard
  // against Strict-mode double mounts and re-renders so we never
  // record the same attempt twice.
  useEffect(() => {
    if (phase !== "done" || submittedRef.current) return;
    submittedRef.current = true;
    const duration = Math.round((Date.now() - startedAtRef.current) / 1000);
    void (async () => {
      try {
        await api.recordQuizAttempt(pathId, { score, total, duration_seconds: duration });
        // Re-fetch stats so the next "Try again" sees the updated best-score.
        const fresh = await api.getQuizStats(pathId);
        setStats(fresh);
      } catch {
        /* stats are best-effort; don't block the score screen */
      }
    })();
  }, [phase, pathId, score, total]);

  const restart = () => {
    setQuestions(shuffle(quiz?.questions ?? []));
    setIndex(0);
    setAnswers([]);
    setPickedChoice(null);
    startedAtRef.current = Date.now();
    submittedRef.current = false;
    setPhase("answering");
  };

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-400">
        <div>
          <Sparkles className="mx-auto mb-2 h-6 w-6 text-ink-600" />
          <p className="mb-3">
            {t("pathQuiz.empty", {
              defaultValue:
                "No quiz questions in this path's cards yet. Add cards with quizzes to start.",
            })}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}`)}
            className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <ChevronLeft className="h-3 w-3" />
            {t("paths.openEditor", { defaultValue: "Open editor" })}
          </button>
        </div>
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MobileDesktopHint reasonKey="mobileHint.paths" />
      {/* Header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}/play`)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            title={t("pathQuiz.backToPlayer", { defaultValue: "Back to player" }) ?? ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-300">
              {t("pathQuiz.title", { defaultValue: "Path quiz" })}
            </p>
            <h1 className="truncate text-sm font-semibold text-ink-100">{quiz.path_title}</h1>
          </div>
          {phase !== "done" && (
            <>
              {stats?.best_score !== null && stats?.best_total ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30"
                  title={t("pathQuiz.bestTooltip", {
                    defaultValue: `Personal best across ${stats.attempt_count} attempts`,
                  }) ?? ""}
                >
                  <Trophy className="h-3 w-3" />
                  {stats.best_score}/{stats.best_total}
                </span>
              ) : null}
              <span className="rounded-md bg-ink-800/60 px-2 py-1 font-mono text-[10px] tabular-nums text-ink-300">
                {Math.min(index + 1, total)} / {total}
              </span>
            </>
          )}
        </div>
        <div className="h-0.5 w-full bg-ink-800">
          <div
            className="h-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-300 transition-all"
            style={{ width: `${(((phase === "done" ? total : index) + (phase === "showing-answer" ? 1 : 0)) / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 pb-16 pt-8">
          {phase === "done" ? (
            <FinalScore
              score={score}
              total={total}
              stats={stats}
              onRestart={restart}
              onBack={() => navigate(`/paths/${pathId}/play`)}
            />
          ) : (
            current && (
              <QuestionCard
                key={current.id}
                question={current}
                isMC={isMC}
                pickedChoice={pickedChoice}
                showAnswer={phase === "showing-answer"}
                onPickChoice={(choice) => {
                  if (phase !== "answering") return;
                  setPickedChoice(choice);
                  // Auto-grade MC: correct or wrong based on the choice.
                  reveal(choice === current.answer ? "correct" : "wrong");
                }}
                onReveal={() => reveal()}
                onSelfRate={(rating) => {
                  // Open-text path: user reveals first, then rates.
                  setAnswers((prev) => [...prev, { questionId: current.id, selfRated: rating }]);
                  next();
                }}
                onNext={next}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Question card ---------------------- */

interface QuestionCardProps {
  question: PathQuizQuestion;
  isMC: boolean;
  pickedChoice: string | null;
  showAnswer: boolean;
  onPickChoice: (choice: string) => void;
  onReveal: () => void;
  onSelfRate: (rating: "correct" | "wrong") => void;
  onNext: () => void;
}

function QuestionCard({
  question,
  isMC,
  pickedChoice,
  showAnswer,
  onPickChoice,
  onReveal,
  onSelfRate,
  onNext,
}: QuestionCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-800/30 p-5">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
        {t("pathQuiz.fromStep", {
          step: question.card_position + 1,
          defaultValue: `From step ${question.card_position + 1}`,
        })}{" "}
        · {question.card_title}
      </p>
      <h2 className="mb-4 text-base font-semibold leading-snug text-ink-100">
        {question.question}
      </h2>

      {isMC && question.choices_json ? (
        <ul className="space-y-2">
          {question.choices_json.map((choice) => {
            const isPicked = pickedChoice === choice;
            const isCorrect = choice === question.answer;
            const styleAfter =
              showAnswer && isCorrect
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                : showAnswer && isPicked && !isCorrect
                  ? "border-red-500/50 bg-red-500/15 text-red-200"
                  : "border-ink-800 bg-ink-900/40 text-ink-200";
            return (
              <li key={choice}>
                <button
                  type="button"
                  disabled={showAnswer}
                  onClick={() => onPickChoice(choice)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition",
                    !showAnswer && "hover:border-fuchsia-500/40 hover:bg-fuchsia-500/5",
                    styleAfter,
                  ].filter(Boolean).join(" ")}
                >
                  <span className="flex-1">{choice}</span>
                  {showAnswer && isCorrect && <Check className="h-4 w-4 text-emerald-300" />}
                  {showAnswer && isPicked && !isCorrect && <X className="h-4 w-4 text-red-300" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : showAnswer ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-300">
            {t("pathQuiz.answer", { defaultValue: "Answer" })}
          </p>
          <p className="text-sm text-emerald-100">{question.answer}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onReveal}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
        >
          {t("pathQuiz.reveal", { defaultValue: "Reveal answer" })}
        </button>
      )}

      {showAnswer && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {isMC ? (
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1.5 rounded-md bg-fuchsia-500/15 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition hover:bg-fuchsia-500/25"
            >
              {t("paths.next", { defaultValue: "Next" })}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onSelfRate("wrong")}
                className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
              >
                <X className="h-3 w-3" />
                {t("pathQuiz.markWrong", { defaultValue: "I was wrong" })}
              </button>
              <button
                type="button"
                onClick={() => onSelfRate("correct")}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/20"
              >
                <Check className="h-3 w-3" />
                {t("pathQuiz.markCorrect", { defaultValue: "I got it" })}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------- Final score ---------------------- */

function FinalScore({
  score,
  total,
  stats,
  onRestart,
  onBack,
}: {
  score: number;
  total: number;
  stats: QuizStats | null;
  onRestart: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const pct = total === 0 ? 0 : Math.round((score / total) * 100);
  const tone =
    pct >= 80
      ? "text-emerald-300"
      : pct >= 50
        ? "text-amber-300"
        : "text-red-300";
  // The stats endpoint includes THIS attempt because we call it after
  // the POST. Compare current run to the personal best so we can call
  // out a new high score.
  const isNewBest =
    stats?.best_score != null &&
    stats?.best_total === total &&
    stats.best_score === score &&
    stats.attempt_count >= 1;
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-800/30 p-6 text-center">
      <Sparkles className={`mx-auto mb-3 h-8 w-8 ${tone}`} />
      <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
        {t("pathQuiz.finalScore", { defaultValue: "Final score" })}
      </p>
      <p className={`text-3xl font-bold ${tone}`}>
        {score} <span className="text-base text-ink-500">/ {total}</span>
      </p>
      <p className="mt-1 text-sm text-ink-300">{pct}%</p>

      {stats && stats.attempt_count > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
          {isNewBest ? (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Trophy className="h-3 w-3" />
              {t("pathQuiz.newBest", { defaultValue: "New personal best!" })}
            </span>
          ) : stats.best_score != null ? (
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3 w-3 text-amber-400" />
              {t("pathQuiz.best", { defaultValue: "Best" })}:{" "}
              <span className="tabular-nums text-ink-200">
                {stats.best_score}/{stats.best_total}
              </span>
            </span>
          ) : null}
          <span className="text-ink-600">·</span>
          <span>
            {t("pathQuiz.attemptCount", {
              count: stats.attempt_count,
              defaultValue: `${stats.attempt_count} attempts`,
            })}
          </span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("pathQuiz.backToPlayer", { defaultValue: "Back to player" })}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-md bg-fuchsia-500/15 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition hover:bg-fuchsia-500/25"
        >
          <RotateCw className="h-3 w-3" />
          {t("pathQuiz.tryAgain", { defaultValue: "Try again" })}
        </button>
      </div>
    </div>
  );
}

/** Fisher-Yates — copies the input. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
