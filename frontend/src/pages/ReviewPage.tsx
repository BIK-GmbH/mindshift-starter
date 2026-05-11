import { ArrowRight, Brain, Calendar, Check, CheckCheck, Eye, Flame, GraduationCap, History, Loader2, RefreshCw, Target, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  api,
  type ActivityDay,
  type LearningSessionItem,
  type ReviewQueueItem,
  type ReviewRating,
  type ReviewStats,
  type SessionDetail,
} from "../lib/api";
import { playSound } from "../lib/sounds";
import PageHeader from "../components/PageHeader";

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

type ReviewMode = "recall" | "mc";
const MODE_KEY = "mindshift.reviewMode";

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
  const [mode, setMode] = useState<ReviewMode>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as ReviewMode) || "recall";
    } catch {
      return "recall";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);
  // Tally of self-ratings within the current session. Resets when the
  // queue is reloaded (refresh).
  const [sessionTally, setSessionTally] = useState<Record<ReviewRating, number>>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });

  // History of past learning sessions + the one currently inspected (if any).
  const [pastSessions, setPastSessions] = useState<LearningSessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionDetail, setActiveSessionDetail] = useState<SessionDetail | null>(null);
  const [activity, setActivity] = useState<ActivityDay[]>([]);

  const refreshHistory = useCallback(async () => {
    try {
      const [list, act] = await Promise.all([
        api.listLearningSessions(),
        api.reviewActivity(365),
      ]);
      setPastSessions(list);
      setActivity(act);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Load the inspected session's events when selected.
  useEffect(() => {
    if (!activeSessionId) {
      setActiveSessionDetail(null);
      return;
    }
    let cancelled = false;
    void api.getLearningSession(activeSessionId).then((d) => {
      if (!cancelled) setActiveSessionDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([api.reviewStats(), api.reviewQueue(50)]);
      setStats(s);
      setQueue(q);
      setPos(0);
      setRevealed(false);
      setSessionTally({ again: 0, hard: 0, good: 0, easy: 0 });
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
      setSessionTally((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));
      if (pos + 1 < queue.length) {
        setPos(pos + 1);
        setRevealed(false);
      } else {
        await refresh();
      }
      void refreshHistory();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setSubmitting(null);
    }
  };

  // Resume hint — the most recent session is the one our auto-bucket would
  // append to right now, IF its ended_at is < 30 min ago. Skip if user is
  // looking at a past session already.
  const resumeHint = useMemo(() => {
    if (activeSessionId || sessionDone > 0 || pastSessions.length === 0) return null;
    const latest = pastSessions[0];
    const endedAt = new Date(latest.ended_at).getTime();
    const ageMinutes = (Date.now() - endedAt) / 60_000;
    return ageMinutes < 30 ? latest : null;
  }, [activeSessionId, sessionDone, pastSessions]);

  return (
    <div className="flex h-full">
      {/* Session sidebar — same width as chat history / tags */}
      <ReviewSidebar
        stats={stats}
        sessionTally={sessionTally}
        sessionDone={sessionDone}
        sessionTotal={sessionTotal}
        progressPct={progressPct}
        mode={mode}
        onModeChange={setMode}
        pastSessions={pastSessions}
        activeSessionId={activeSessionId}
        onPickSession={setActiveSessionId}
        activity={activity}
      />

      {/* Main column */}
      <div className="flex flex-1 min-w-0 flex-col">
        <PageHeader
          icon={GraduationCap}
          tone="amber"
          title={t("nav.review")}
          subtitle={t("review.subtitle")}
        />

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 pb-12 pt-6">
            {error && (
              <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            {activeSessionId ? (
              <SessionDetailView
                detail={activeSessionDetail}
                onClose={() => setActiveSessionId(null)}
                onOpenCard={(id) => navigate(`/cards/${id}`)}
              />
            ) : loading ? (
              <ReviewSkeleton />
            ) : current ? (
              <>
                {resumeHint && (
                  <ResumeHint endedAt={resumeHint.ended_at} count={resumeHint.event_count} />
                )}
                <ReviewCard
                  key={current.id}
                  item={current}
                  revealed={revealed}
                  submitting={submitting}
                  mode={mode}
                  onReveal={() => setRevealed(true)}
                  onRate={onRating}
                  onOpenCard={() => navigate(`/cards/${current.card_id}`)}
                  progress={{ current: pos + 1, total: queue.length }}
                />
              </>
            ) : (
              <DoneState onCheckAgain={() => void refresh()} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewSidebar({
  stats,
  sessionTally,
  sessionDone,
  sessionTotal,
  progressPct,
  mode,
  onModeChange,
  pastSessions,
  activeSessionId,
  onPickSession,
  activity,
}: {
  stats: ReviewStats | null;
  sessionTally: Record<ReviewRating, number>;
  sessionDone: number;
  sessionTotal: number;
  progressPct: number;
  mode: ReviewMode;
  onModeChange: (m: ReviewMode) => void;
  pastSessions: LearningSessionItem[];
  activeSessionId: string | null;
  onPickSession: (id: string | null) => void;
  activity: ActivityDay[];
}) {
  const { t } = useTranslation();
  const stages: { key: keyof ReviewStats; labelKey: string; dot: string }[] = [
    { key: "new", labelKey: "review.stats.new", dot: "bg-ink-500" },
    { key: "learning", labelKey: "review.stats.learning", dot: "bg-amber-400" },
    { key: "practiced", labelKey: "review.stats.practiced", dot: "bg-emerald-400" },
    { key: "confident", labelKey: "review.stats.confident", dot: "bg-sky-400" },
    { key: "mastered", labelKey: "review.stats.mastered", dot: "bg-violet-400" },
  ];
  const totalAcross =
    stats != null
      ? stages.reduce((sum, s) => sum + Number(stats[s.key] || 0), 0) || 1
      : 1;

  return (
    <aside className="panel-elevated hidden md:flex w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
      {/* Header row — structural, never scrolls. Matches the Library /
          Graph sidebar pattern: header sits above the scroll boundary,
          content slides up to it but never under it. min-h matches the
          height the Library/Graph headers reach with their action
          button so navigating between sections doesn't shift the page
          vertically. */}
      <div className="flex flex-shrink-0 items-center border-b border-ink-800 px-4 py-3 min-h-[3.25rem]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
          {t("review.sidebar.heading", { defaultValue: "This session" })}
        </span>
      </div>

      {/* Scroll body — everything below the header lives in this
          bounded flex column. On tall viewports the top block stays
          flex-shrink-0 and the History flex-1 absorbs the remaining
          space (with its inner list scrolling). On short viewports
          this body's own overflow-y-auto kicks in and the whole stack
          (stats + history) scrolls past the fixed header. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">

      {/* Top stats: Mode / Due / Mastery / Tally / Activity. */}
      <div className="flex-shrink-0 space-y-5 px-4 pt-4 pb-2">
        {/* Mode toggle — recall vs multiple-choice */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <Brain className="h-3 w-3" />
            {t("review.sidebar.mode", { defaultValue: "Mode" })}
          </div>
          <div className="grid grid-cols-2 gap-0.5 rounded-md bg-ink-800/60 p-0.5 ring-1 ring-ink-700">
            <button
              type="button"
              onClick={() => onModeChange("recall")}
              className={[
                "rounded px-2 py-1 text-[11px] font-medium transition",
                mode === "recall" ? "bg-ink-100 text-ink-900" : "text-ink-300 hover:text-ink-100",
              ].join(" ")}
            >
              {t("review.mode.recall", { defaultValue: "Recall" })}
            </button>
            <button
              type="button"
              onClick={() => onModeChange("mc")}
              className={[
                "rounded px-2 py-1 text-[11px] font-medium transition",
                mode === "mc" ? "bg-ink-100 text-ink-900" : "text-ink-300 hover:text-ink-100",
              ].join(" ")}
            >
              {t("review.mode.mc", { defaultValue: "Choice" })}
            </button>
          </div>
          <p className="text-[10px] leading-snug text-ink-500">
            {mode === "recall"
              ? t("review.mode.recallHint", {
                  defaultValue: "Read, think, reveal, self-rate. Strongest for memory.",
                })
              : t("review.mode.mcHint", {
                  defaultValue: "Pick from 4 options. Faster, easier on review days.",
                })}
          </p>
        </section>

        {/* Today / due */}
        <section className="space-y-2 rounded-lg border border-ink-800 bg-ink-800/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <Target className="h-3 w-3" />
            {t("review.sidebar.due", { defaultValue: "Due now" })}
          </div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-semibold tabular-nums text-amber-300">
              {stats?.due_now ?? 0}
            </span>
            <span className="text-[10px] text-ink-500">
              / {stats?.total ?? 0} {t("review.stats.total")}
            </span>
          </div>
          {sessionTotal > 0 && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[10px] text-ink-500">
                {sessionDone} / {sessionTotal} {t("review.sidebar.reviewed", { defaultValue: "reviewed" })}
              </p>
            </>
          )}
        </section>

        {/* Mastery distribution — proportional bars */}
        {stats && (
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              {t("review.sidebar.mastery", { defaultValue: "Mastery" })}
            </div>
            <div className="space-y-1.5">
              {stages.map(({ key, labelKey, dot }) => {
                const value = Number(stats[key] || 0);
                const pct = (value / totalAcross) * 100;
                return (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px] text-ink-300">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                        {t(labelKey)}
                      </span>
                      <span className="tabular-nums text-ink-400">{value}</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800/60">
                      <div
                        className={`h-full rounded-full ${dot} opacity-70`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Session tally */}
        {sessionDone > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <Flame className="h-3 w-3" />
              {t("review.sidebar.tally", { defaultValue: "Your answers" })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <TallyTile
                label={t("review.rating.again")}
                value={sessionTally.again}
                tone="text-red-300 bg-red-500/10 ring-red-500/30"
              />
              <TallyTile
                label={t("review.rating.hard")}
                value={sessionTally.hard}
                tone="text-amber-300 bg-amber-500/10 ring-amber-500/30"
              />
              <TallyTile
                label={t("review.rating.good")}
                value={sessionTally.good}
                tone="text-emerald-300 bg-emerald-500/10 ring-emerald-500/30"
              />
              <TallyTile
                label={t("review.rating.easy")}
                value={sessionTally.easy}
                tone="text-sky-300 bg-sky-500/10 ring-sky-500/30"
              />
            </div>
          </section>
        )}

        {/* Activity heatmap — last year of answers per day */}
        {activity.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <Calendar className="h-3 w-3" />
              {t("review.sidebar.streak", { defaultValue: "Activity" })}
            </div>
            <ActivityHeatmap days={activity} />
          </section>
        )}
      </div>

      {/* History — past learning sessions. flex-1 lets it take the
          remaining space inside the scroll body on tall viewports; its
          inner list has its own overflow-y-auto so only the list
          scrolls when there's room. min-h floor keeps the section
          visible even when the body is in scroll-the-whole-stack mode
          on short viewports. */}
      {pastSessions.length > 0 && (
        <div className="flex min-h-[12rem] flex-1 flex-col border-t border-ink-800 px-4 pt-4">
          <div className="mb-2 flex flex-shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <History className="h-3 w-3" />
            {t("review.sidebar.history", { defaultValue: "History" })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <SessionHistoryList
              sessions={pastSessions}
              activeId={activeSessionId}
              onPick={onPickSession}
            />
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}

function SessionHistoryList({
  sessions,
  activeId,
  onPick,
}: {
  sessions: LearningSessionItem[];
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(
    () =>
      groupSessionsByBucket(sessions, {
        today: t("review.history.today", { defaultValue: "Today" }),
        yesterday: t("review.history.yesterday", { defaultValue: "Yesterday" }),
        thisWeek: t("review.history.thisWeek", { defaultValue: "This week" }),
      }),
    [sessions, t],
  );
  return (
    <div className="space-y-2">
      {groups.map(({ label, items }) => (
        <div key={label}>
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {label}
          </p>
          <ul className="space-y-0.5">
            {items.map((s) => {
              const date = new Date(s.ended_at);
              const time = date.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              });
              const correctPct = s.event_count
                ? Math.round((s.correct_count / s.event_count) * 100)
                : 0;
              const isActive = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onPick(isActive ? null : s.id)}
                    className={[
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition",
                      isActive
                        ? "bg-ink-700/70 text-ink-100"
                        : "text-ink-300 hover:bg-ink-800",
                    ].join(" ")}
                    title={t("review.history.openTooltip", { defaultValue: "Show this session" }) ?? ""}
                  >
                    <span className="flex flex-col leading-tight">
                      <span className="text-[11px] tabular-nums">{time}</span>
                      <span className="text-[10px] text-ink-500">
                        {s.event_count} · {correctPct}%
                      </span>
                    </span>
                    <span
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        correctPct >= 70
                          ? "bg-emerald-400"
                          : correctPct >= 40
                            ? "bg-amber-400"
                            : "bg-red-400",
                      ].join(" ")}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function groupSessionsByBucket(
  sessions: LearningSessionItem[],
  labels: { today: string; yesterday: string; thisWeek: string },
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const thisWeekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  const buckets: { key: string; label: string; items: LearningSessionItem[] }[] = [];
  const ensure = (key: string, label: string) => {
    let b = buckets.find((x) => x.key === key);
    if (!b) {
      b = { key, label, items: [] };
      buckets.push(b);
    }
    return b;
  };

  for (const s of sessions) {
    const ended = new Date(s.ended_at);
    if (ended >= today) {
      ensure("today", labels.today).items.push(s);
    } else if (ended >= yesterday) {
      ensure("yesterday", labels.yesterday).items.push(s);
    } else if (ended >= thisWeekStart) {
      ensure("week", labels.thisWeek).items.push(s);
    } else {
      const label = ended.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      ensure(`d-${label}`, label).items.push(s);
    }
  }
  return buckets;
}

function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  // Build a map from YYYY-MM-DD → count and lay out 53 weeks × 7 days going
  // back from today. Today sits in the bottom-right.
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.date, d.count);
    return m;
  }, [days]);

  const weeks = 26; // half year — enough for the slim sidebar
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align so the last column ends today.
  const offsetEnd = (today.getDay() + 6) % 7; // mon=0..sun=6 → days into current week
  const grid: { date: Date; count: number }[][] = [];
  for (let w = 0; w < weeks; w += 1) {
    const col: { date: Date; count: number }[] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      const daysAgo = (weeks - 1 - w) * 7 + (offsetEnd - dow);
      const d = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      col.push({ date: d, count: byDate.get(key) ?? 0 });
    }
    grid.push(col);
  }

  const intensity = (n: number) => {
    if (n === 0) return "bg-ink-800/60";
    if (n < 3) return "bg-emerald-500/30";
    if (n < 8) return "bg-emerald-500/55";
    if (n < 16) return "bg-emerald-400/80";
    return "bg-emerald-300";
  };

  const totalThisYear = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-1.5">
      <div
        className="grid grid-flow-col gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
          gridTemplateRows: "repeat(7, minmax(0, 1fr))",
        }}
      >
        {grid.flatMap((col, wi) =>
          col.map(({ date, count }, di) => (
            <span
              key={`${wi}-${di}`}
              title={`${date.toLocaleDateString()} — ${count}`}
              className={`aspect-square rounded-[2px] ${intensity(count)}`}
            />
          )),
        )}
      </div>
      <p className="text-[10px] text-ink-500">{totalThisYear} answers · last 26 weeks</p>
    </div>
  );
}

function TallyTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ring-1 ${tone}`}>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

function ReviewCard({
  item,
  revealed,
  submitting,
  mode,
  onReveal,
  onRate,
  onOpenCard,
  progress,
}: {
  item: ReviewQueueItem;
  revealed: boolean;
  submitting: ReviewRating | null;
  mode: ReviewMode;
  onReveal: () => void;
  onRate: (rating: ReviewRating) => void;
  onOpenCard: () => void;
  progress: { current: number; total: number };
}) {
  const { t } = useTranslation();
  const stageBadge = STAGE_COLORS[item.stage] ?? "bg-ink-700 text-ink-200";

  // MC mode is only feasible if we actually have distractors. Otherwise
  // fall back to recall and surface a small notice so the user knows.
  const hasChoices = mode === "mc" && item.choices_json && item.choices_json.length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-b from-ink-800/60 to-ink-800/30 surface-elevated">
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

        {hasChoices ? (
          <ChoiceGrid item={item} onRate={onRate} submitting={submitting} />
        ) : !revealed ? (
          <>
            {mode === "mc" && (
              <p className="mt-3 text-[11px] text-ink-500">
                {t("review.mode.noChoices", {
                  defaultValue: "No choices stored for this question — falling back to recall.",
                })}
              </p>
            )}
            <button
              type="button"
              onClick={onReveal}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-900/60 py-3 text-sm font-medium text-ink-100 transition hover:border-ink-500 hover:bg-ink-800"
            >
              <Eye className="h-4 w-4" />
              {t("review.reveal")}
            </button>
          </>
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

function ChoiceGrid({
  item,
  onRate,
  submitting,
}: {
  item: ReviewQueueItem;
  onRate: (rating: ReviewRating) => void;
  submitting: ReviewRating | null;
}) {
  const { t } = useTranslation();
  // Stable, shuffled order per question id so choices don't flicker on
  // re-renders while the user is reading them.
  const order = useMemo(() => {
    const all = [item.answer, ...(item.choices_json ?? [])];
    const seed = hashString(item.id);
    return seededShuffle(all, seed);
  }, [item.id, item.answer, item.choices_json]);

  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setPicked(null);
  }, [item.id]);

  const onPick = (choice: string) => {
    if (picked || submitting) return;
    setPicked(choice);
    const correct = choice === item.answer;
    playSound(correct ? "success" : "error");
    // Map MC outcome onto the spaced-repetition rating system. The user
    // can still re-rate via keyboard if they want finer control later.
    window.setTimeout(() => onRate(correct ? "good" : "again"), 700);
  };

  return (
    <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {order.map((choice) => {
        const isPicked = picked === choice;
        const isCorrect = choice === item.answer;
        const showResult = picked !== null;
        let toneClass = "border-ink-700 bg-ink-900/40 text-ink-100 hover:border-ink-500 hover:bg-ink-800/60";
        if (showResult) {
          if (isCorrect) {
            toneClass =
              "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30";
          } else if (isPicked) {
            toneClass =
              "border-red-500/50 bg-red-500/10 text-red-200 ring-1 ring-red-500/30";
          } else {
            toneClass = "border-ink-700 bg-ink-900/30 text-ink-500";
          }
        }
        return (
          <button
            key={choice}
            type="button"
            onClick={() => onPick(choice)}
            disabled={picked !== null || submitting !== null}
            className={[
              "flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm leading-relaxed transition",
              toneClass,
            ].join(" ")}
            aria-label={
              showResult
                ? isCorrect
                  ? t("review.mc.correct", { defaultValue: "Correct" })
                  : isPicked
                  ? t("review.mc.wrong", { defaultValue: "Wrong" })
                  : undefined
                : undefined
            }
          >
            <span className="flex-1">{choice}</span>
            {showResult && isCorrect && <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />}
            {showResult && isPicked && !isCorrect && <X className="mt-0.5 h-4 w-4 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

// Tiny deterministic shuffle — mulberry32-style. Keeps the choice order
// stable per question without storing it on the server.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

function ResumeHint({ endedAt, count }: { endedAt: string; count: number }) {
  const { t } = useTranslation();
  const time = new Date(endedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-ink-800/60 px-3 py-1 text-[11px] text-ink-300 ring-1 ring-ink-700">
      <History className="h-3 w-3 text-ink-400" />
      {t("review.resumeHint", {
        time,
        count,
        defaultValue: `Continuing your ${time} session (${count} so far)`,
      })}
    </div>
  );
}

function SessionDetailView({
  detail,
  onClose,
  onOpenCard,
}: {
  detail: SessionDetail | null;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
}) {
  const { t } = useTranslation();
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-ink-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  const started = new Date(detail.started_at);
  const ended = new Date(detail.ended_at);
  const durationMin = Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60_000));
  const correctPct = detail.event_count
    ? Math.round((detail.correct_count / detail.event_count) * 100)
    : 0;
  const dateLabel = started.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeRange = `${started.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – ${ended.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-ink-800 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-100">{dateLabel}</h2>
          <p className="text-xs text-ink-400">
            {timeRange} · {detail.event_count}{" "}
            {t("review.history.answers", { defaultValue: "answers" })} · {correctPct}%{" "}
            {t("review.history.correct", { defaultValue: "correct" })} ·{" "}
            {t("review.history.duration", { defaultValue: "{{min}} min", min: durationMin })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-ink-800"
        >
          <X className="h-3 w-3" />
          {t("common.close", { defaultValue: "Close" })}
        </button>
      </div>

      {detail.events.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-4 py-6 text-center text-sm text-ink-400">
          {t("review.history.empty", { defaultValue: "No events in this session." })}
        </p>
      ) : (
        <ul className="space-y-2">
          {detail.events.map((ev) => {
            const stage = ev.stage ?? "new";
            const stageClass = STAGE_COLORS[stage] ?? STAGE_COLORS.new;
            const ratingTone =
              ev.rating === "again"
                ? "bg-red-500/15 text-red-300 ring-red-500/30"
                : ev.rating === "hard"
                  ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                  : ev.rating === "good"
                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                    : "bg-sky-500/15 text-sky-300 ring-sky-500/30";
            return (
              <li
                key={ev.id}
                className="rounded-lg border border-ink-800 bg-ink-800/30 p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${ratingTone}`}>
                    {t(`review.rating.${ev.rating}`)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${stageClass}`}>
                    {t(`review.stage.${stage}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenCard(ev.card_id)}
                    className="ml-auto truncate text-[11px] text-ink-400 transition hover:text-ink-100"
                    title={ev.card_title}
                  >
                    {ev.card_title}
                  </button>
                </div>
                <p className="text-sm leading-snug text-ink-100">{ev.question}</p>
                <p className="mt-1 text-xs leading-snug text-ink-400">{ev.answer}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
