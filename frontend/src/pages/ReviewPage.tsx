import { ArrowRight, CheckCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type ReviewQueueItem, type ReviewRating, type ReviewStats } from "../lib/api";

const RATINGS: { id: ReviewRating; classes: string }[] = [
  { id: "again", classes: "bg-red-500/20 text-red-300 hover:bg-red-500/30" },
  { id: "hard", classes: "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30" },
  { id: "good", classes: "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30" },
  { id: "easy", classes: "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30" },
];

export default function ReviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<ReviewRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([api.reviewStats(), api.reviewQueue(50)]);
      setStats(s);
      setQueue(q);
      setPos(0);
      setRevealed(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = queue[pos];

  const onRating = async (rating: ReviewRating) => {
    if (!current || submitting) return;
    setSubmitting(rating);
    try {
      await api.submitReviewAnswer(current.id, rating);
      // Optimistic stats update for "due_now"
      setStats((s) => (s ? { ...s, due_now: Math.max(0, s.due_now - 1) } : s));
      if (pos + 1 < queue.length) {
        setPos(pos + 1);
        setRevealed(false);
      } else {
        // Reached end of session — refresh from backend (may surface freshly due ones)
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.review")}</h1>
        <p className="text-sm text-ink-300">{t("review.subtitle")}</p>
      </header>

      {stats && <StatsBar stats={stats} />}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-ink-300">{t("common.loading")}</p>
      ) : current ? (
        <ReviewCard
          item={current}
          revealed={revealed}
          submitting={submitting}
          onReveal={() => setRevealed(true)}
          onRate={onRating}
          onOpenCard={() => navigate(`/cards/${current.card_id}`)}
          progress={{ current: pos + 1, total: queue.length }}
        />
      ) : (
        <DoneState onCheckAgain={() => void refresh()} />
      )}
    </div>
  );
}

function StatsBar({ stats }: { stats: ReviewStats }) {
  const { t } = useTranslation();
  const items: { key: keyof ReviewStats; labelKey: string }[] = [
    { key: "due_now", labelKey: "review.stats.due" },
    { key: "new", labelKey: "review.stats.new" },
    { key: "learning", labelKey: "review.stats.learning" },
    { key: "practiced", labelKey: "review.stats.practiced" },
    { key: "confident", labelKey: "review.stats.confident" },
    { key: "mastered", labelKey: "review.stats.mastered" },
    { key: "total", labelKey: "review.stats.total" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((item) => (
        <div key={item.key} className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2">
          <div className="text-lg font-semibold text-ink-100">{stats[item.key]}</div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">{t(item.labelKey)}</div>
        </div>
      ))}
    </div>
  );
}

function ReviewCard({
  item,
  revealed,
  submitting,
  onReveal,
  onRate,
  onOpenCard,
  progress,
}: {
  item: ReviewQueueItem;
  revealed: boolean;
  submitting: ReviewRating | null;
  onReveal: () => void;
  onRate: (rating: ReviewRating) => void;
  onOpenCard: () => void;
  progress: { current: number; total: number };
}) {
  const { t } = useTranslation();

  const stageBadge = useMemo(
    () => `bg-ink-700 text-ink-200`,
    [],
  );

  return (
    <div className="mt-6 rounded-lg border border-ink-700 bg-ink-800 p-6">
      <div className="mb-4 flex items-center justify-between text-xs text-ink-400">
        <button
          type="button"
          onClick={onOpenCard}
          className="inline-flex items-center gap-1 text-ink-300 hover:text-ink-100"
          title={item.card_title}
        >
          <span className="max-w-[300px] truncate">{item.card_title}</span>
          <ArrowRight className="h-3 w-3" />
        </button>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${stageBadge}`}>
            {t(`review.stage.${item.stage}`)}
          </span>
          <span>
            {progress.current} / {progress.total}
          </span>
        </div>
      </div>

      <h2 className="mb-6 text-lg font-medium leading-snug">{item.question}</h2>

      {!revealed ? (
        <button
          type="button"
          onClick={onReveal}
          className="w-full rounded-md border border-ink-600 bg-ink-900 py-3 text-sm font-medium text-ink-100 hover:border-ink-500"
        >
          {t("review.reveal")}
        </button>
      ) : (
        <>
          <div className="mb-6 rounded-md border border-ink-700 bg-ink-900 p-4 text-sm leading-relaxed">
            {item.answer}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map(({ id, classes }) => (
              <button
                key={id}
                type="button"
                disabled={submitting !== null}
                onClick={() => onRate(id)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium transition disabled:opacity-50 ${classes}`}
              >
                {submitting === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t(`review.rating.${id}`)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DoneState({ onCheckAgain }: { onCheckAgain: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-600 p-12 text-center">
      <CheckCheck className="h-8 w-8 text-emerald-400" />
      <h2 className="text-lg font-medium">{t("review.done.title")}</h2>
      <p className="text-sm text-ink-300">{t("review.done.body")}</p>
      <button
        type="button"
        onClick={onCheckAgain}
        className="mt-2 rounded border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
      >
        {t("review.done.refresh")}
      </button>
    </div>
  );
}
