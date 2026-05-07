import { ArrowRight, CheckCheck, Eye, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type ReviewQueueItem, type ReviewRating, type ReviewStats } from "../lib/api";

const RATINGS: { id: ReviewRating; classes: string; hint: string }[] = [
  {
    id: "again",
    classes: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25",
    hint: "<10m",
  },
  {
    id: "hard",
    classes: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/25",
    hint: "×1.2",
  },
  {
    id: "good",
    classes: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25",
    hint: "×2.5",
  },
  {
    id: "easy",
    classes: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25",
    hint: "×4",
  },
];

const STAGE_COLORS: Record<string, string> = {
  new: "bg-ink-700 text-ink-200",
  learning: "bg-amber-500/20 text-amber-300",
  practiced: "bg-emerald-500/20 text-emerald-300",
  confident: "bg-sky-500/20 text-sky-300",
  mastered: "bg-violet-500/20 text-violet-300",
};

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
  const [sessionStart] = useState(0);

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
  const sessionTotal = queue.length - sessionStart;
  const sessionDone = pos - sessionStart;
  const progressPct =
    sessionTotal > 0 ? Math.round((sessionDone / sessionTotal) * 100) : 0;

  const onRating = async (rating: ReviewRating) => {
    if (!current || submitting) return;
    setSubmitting(rating);
    try {
      await api.submitReviewAnswer(current.id, rating);
      setStats((s) => (s ? { ...s, due_now: Math.max(0, s.due_now - 1) } : s));
      if (pos + 1 < queue.length) {
        setPos(pos + 1);
        setRevealed(false);
      } else {
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header + stats */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-8 pb-4 pt-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
                {t("nav.review")}
              </h1>
              <p className="mt-1 text-sm text-ink-400">{t("review.subtitle")}</p>
            </div>
            {sessionTotal > 0 && (
              <div className="text-right text-xs text-ink-400">
                <div className="tabular-nums text-ink-200">
                  {sessionDone} / {sessionTotal}
                </div>
                <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {stats && <StatsBar stats={stats} />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-12 pt-6">
          {error && (
            <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading ? (
            <ReviewSkeleton />
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
      </div>
    </div>
  );
}

function StatsBar({ stats }: { stats: ReviewStats }) {
  const { t } = useTranslation();
  const items: { key: keyof ReviewStats; labelKey: string; accent?: string }[] = [
    { key: "due_now", labelKey: "review.stats.due", accent: "text-amber-300" },
    { key: "new", labelKey: "review.stats.new" },
    { key: "learning", labelKey: "review.stats.learning" },
    { key: "practiced", labelKey: "review.stats.practiced" },
    { key: "confident", labelKey: "review.stats.confident" },
    { key: "mastered", labelKey: "review.stats.mastered", accent: "text-violet-300" },
    { key: "total", labelKey: "review.stats.total" },
  ];
  return (
    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((item) => (
        <div
          key={item.key}
          className="rounded-lg border border-ink-800 bg-ink-800/40 px-3 py-2"
        >
          <div className={`text-lg font-semibold tabular-nums ${item.accent ?? "text-ink-100"}`}>
            {stats[item.key]}
          </div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500">
            {t(item.labelKey)}
          </div>
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
  const stageBadge = STAGE_COLORS[item.stage] ?? "bg-ink-700 text-ink-200";

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-b from-ink-800/60 to-ink-800/30 shadow-xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-ink-800 bg-ink-800/40 px-5 py-2.5">
        <button
          type="button"
          onClick={onOpenCard}
          className="group inline-flex items-center gap-1.5 text-xs text-ink-400 transition hover:text-ink-100"
          title={item.card_title}
        >
          <span className="max-w-[280px] truncate">{item.card_title}</span>
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </button>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${stageBadge}`}>
            {t(`review.stage.${item.stage}`)}
          </span>
          <span className="text-[10px] tabular-nums text-ink-500">
            {progress.current} / {progress.total}
          </span>
        </div>
      </div>

      <div className="px-6 py-8">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
          {t("review.questionLabel")}
        </div>
        <h2 className="text-lg font-medium leading-relaxed text-ink-100">{item.question}</h2>

        {!revealed ? (
          <button
            type="button"
            onClick={onReveal}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-900/60 py-3 text-sm font-medium text-ink-100 transition hover:border-ink-500 hover:bg-ink-800"
          >
            <Eye className="h-4 w-4" />
            {t("review.reveal")}
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-ink-900/60 p-5 text-sm leading-relaxed text-ink-200 ring-1 ring-ink-700">
              {item.answer}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATINGS.map(({ id, classes, hint }) => (
                <button
                  key={id}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => onRate(id)}
                  className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${classes}`}
                >
                  {submitting === id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>{t(`review.rating.${id}`)}</span>
                  )}
                  <span className="text-[10px] opacity-60">{hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-800/30">
      <div className="border-b border-ink-800 bg-ink-800/40 px-5 py-2.5">
        <div className="h-3 w-1/2 animate-pulse rounded bg-ink-800" />
      </div>
      <div className="px-6 py-8">
        <div className="space-y-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-ink-800" />
          <div className="h-5 w-full animate-pulse rounded bg-ink-800" />
          <div className="h-5 w-2/3 animate-pulse rounded bg-ink-800" />
          <div className="mt-6 h-12 animate-pulse rounded-xl bg-ink-800" />
        </div>
      </div>
    </div>
  );
}

function DoneState({ onCheckAgain }: { onCheckAgain: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-ink-700 bg-ink-800/30 p-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
        <CheckCheck className="h-6 w-6 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-ink-100">{t("review.done.title")}</h2>
        <p className="mt-1 text-sm text-ink-400">{t("review.done.body")}</p>
      </div>
      <button
        type="button"
        onClick={onCheckAgain}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-800"
      >
        <RefreshCw className="h-3 w-3" />
        {t("review.done.refresh")}
      </button>
    </div>
  );
}
