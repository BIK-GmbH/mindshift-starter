import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  /** Card status that triggered this skeleton — drives the message
   *  text ("queued" vs "processing") and the spinner. */
  status: "queued" | "processing";
  /** When known, render a thumbnail at the top to anchor the layout
   *  (YouTube card detail / side panel embed). */
  thumbnailUrl?: string | null;
  title?: string | null;
  /** Layout density — "compact" for the side-panel iframe, "full" for
   *  the main app's card detail. */
  variant?: "compact" | "full";
}

/**
 * Animated placeholder shown while a card's ingestion pipeline is
 * still running. Replaces the empty / partial content the user
 * otherwise sees ("queued" pill + blank tabs).
 *
 * Layout deliberately mirrors the finished card view (hero → title →
 * tags → tabs → content) so the page doesn't shift when ingestion
 * completes and the real content swaps in. The "Card wird generiert…"
 * banner sits at the bottom (not the top) for the same reason —
 * removing it from the bottom shifts only the scroll-bottom, not
 * what the user is currently reading.
 *
 * Both dark and light themes get strong contrast: dark uses fuchsia
 * accent on near-black, light uses fuchsia-700 ink on a fuchsia-50
 * tint so the message stays readable on a white side panel.
 */
export default function IngestionSkeleton({
  status,
  thumbnailUrl,
  title,
  variant = "full",
}: Props) {
  const { t } = useTranslation();
  const [phaseIdx, setPhaseIdx] = useState(0);

  const phases = [
    t("ingest.phase.fetching", { defaultValue: "Fetching source content…" }),
    t("ingest.phase.transcript", { defaultValue: "Extracting transcript…" }),
    t("ingest.phase.summary", { defaultValue: "Drafting AI summary…" }),
    t("ingest.phase.tags", { defaultValue: "Generating tags & quiz…" }),
    t("ingest.phase.embedding", { defaultValue: "Computing embeddings…" }),
  ];

  useEffect(() => {
    const id = window.setInterval(() => {
      setPhaseIdx((i) => (i + 1) % phases.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [phases.length]);

  const compact = variant === "compact";

  return (
    <div className={compact ? "p-3" : "mx-auto max-w-3xl px-6 py-6"}>
      {/* Hero — real if we have a thumbnail, else a shimmering tile.
          Same dimensions as the finished view's hero so swap-in is
          near-imperceptible. */}
      {thumbnailUrl ? (
        <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-xl bg-ink-800">
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover opacity-80" />
          <div className="pointer-events-none absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      ) : (
        <div className="mb-3 aspect-video w-full overflow-hidden rounded-xl bg-ink-800">
          <div className="h-full w-full animate-shimmer bg-gradient-to-r from-ink-800 via-ink-700/60 to-ink-800" />
        </div>
      )}

      {/* Title — real if known, else two shimmer lines. */}
      {title ? (
        <h2
          className={[
            "mb-2 font-semibold leading-snug text-ink-100",
            compact ? "text-base" : "text-xl",
          ].join(" ")}
        >
          {title}
        </h2>
      ) : (
        <div className="mb-3 space-y-2">
          <SkeletonLine width="80%" />
          <SkeletonLine width="55%" />
        </div>
      )}

      {/* Tag pill placeholders */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <SkeletonPill width={64} />
        <SkeletonPill width={48} />
        <SkeletonPill width={72} />
        <SkeletonPill width={56} />
      </div>

      {/* Summary block */}
      <SkeletonBlock label={t("ingest.section.summary", { defaultValue: "Summary" })}>
        <SkeletonLine width="100%" />
        <SkeletonLine width="95%" />
        <SkeletonLine width="88%" />
        <SkeletonLine width="60%" />
      </SkeletonBlock>

      {/* Takeaways block */}
      <SkeletonBlock label={t("ingest.section.takeaways", { defaultValue: "Key takeaways" })}>
        <SkeletonBullet width="92%" />
        <SkeletonBullet width="80%" />
        <SkeletonBullet width="86%" />
      </SkeletonBlock>

      {/* Status banner — full variant only. Compact (side-panel embed)
          surfaces the same status as a small round spinner badge in
          the always-visible mini-bar instead, which keeps the panel's
          tight vertical budget for skeleton content. */}
      {!compact && (
        <div
          className="mt-2 flex items-center gap-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 ring-1 ring-fuchsia-200 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:ring-fuchsia-500/30"
        >
          <div className="relative flex-shrink-0">
            <Sparkles className="h-5 w-5 text-fuchsia-700 dark:text-fuchsia-300" />
            <Sparkles className="absolute inset-0 h-5 w-5 animate-ping text-fuchsia-700/50 dark:text-fuchsia-300/60" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-100">
              {status === "queued"
                ? t("ingest.queued", { defaultValue: "Queued for processing…" })
                : t("ingest.processing", { defaultValue: "Generating your card…" })}
            </p>
            <p className="truncate text-xs text-fuchsia-700 dark:text-fuchsia-200/80">
              {phases[phaseIdx]}
            </p>
          </div>
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-fuchsia-700 dark:text-fuchsia-300" />
        </div>
      )}
    </div>
  );
}

/* --------------------------- primitives --------------------------- */

/**
 * Light-mode shimmer needs a different gradient — ink-800/700 in light
 * are nearly white and the shimmer effect disappears. We pin specific
 * grey values for both modes so the placeholder reads as "loading"
 * regardless of theme.
 */
function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 animate-shimmer rounded bg-gradient-to-r from-ink-200 via-ink-300 to-ink-200 dark:from-ink-800 dark:via-ink-700 dark:to-ink-800"
      style={{ width }}
    />
  );
}

function SkeletonPill({ width }: { width: number }) {
  return (
    <div
      className="h-5 animate-shimmer rounded-full bg-gradient-to-r from-ink-200 via-ink-300 to-ink-200 dark:from-ink-800 dark:via-ink-700 dark:to-ink-800"
      style={{ width: `${width}px` }}
    />
  );
}

function SkeletonBullet({ width }: { width: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 dark:bg-ink-600" />
      <div
        className="h-3 animate-shimmer rounded bg-gradient-to-r from-ink-200 via-ink-300 to-ink-200 dark:from-ink-800 dark:via-ink-700 dark:to-ink-800"
        style={{ width }}
      />
    </div>
  );
}

function SkeletonBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-500">
        {label}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
