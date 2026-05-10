import { Hash } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { QuizQuestion } from "../../lib/api";

interface QuizTabProps {
  quiz: QuizQuestion[];
  /** "completed" → show "no quiz yet"; otherwise → show "wait for processing". */
  cardStatus: string;
}

export default function QuizTab({ quiz, cardStatus }: QuizTabProps) {
  const { t } = useTranslation();
  if (quiz.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-ink-400">
        {cardStatus === "completed"
          ? t("card.quiz.empty", { defaultValue: "No quiz questions for this card." })
          : t("card.quiz.processing", {
              defaultValue: "Quiz will appear once the card finishes processing.",
            })}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {quiz.map((q, i) => (
        <QuizCard key={q.id} index={i + 1} question={q} />
      ))}
    </div>
  );
}

function QuizCard({ index, question }: { index: number; question: QuizQuestion }) {
  const { t } = useTranslation();
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
