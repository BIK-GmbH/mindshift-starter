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
 * Visuals:
 *   - thumbnail (real, if available) with a subtle shimmer overlay
 *   - title line (real if known, else shimmer)
 *   - shimmering bars for the summary, takeaways, tags
 *   - phase indicator that cycles through "Reading transcript…",
 *     "Drafting summary…", etc. so the user sees something happening
 *     even though the work is server-side
 *
 * No backend coupling beyond the status prop — caller decides when
 * to render this vs. the real content.
 */
export default function IngestionSkeleton({
  status,
  thumbnailUrl,
  title,
  variant = "full",
}: Props) {
  const { t } = useTranslation();
  const [phaseIdx, setPhaseIdx] = useState(0);

  // Cycle through fake "stages" every 4s so the indicator feels alive
  // without claiming false precision. We don't actually know what the
  // backend is doing right this second.
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
      {/* Status banner with rotating phase */}
      <div
        className={[
          "mb-4 flex items-center gap-3 rounded-xl border border-fuchsia-500/30 bg-gradient-to-r from-fuchsia-500/10 via-violet-500/10 to-fuchsia-500/10 backdrop-blur",
          compact ? "px-3 py-2" : "px-4 py-3",
        ].join(" ")}
      >
        <div className="relative flex-shrink-0">
          <Sparkles className={compact ? "h-4 w-4 text-fuchsia-300" : "h-5 w-5 text-fuchsia-300"} />
          <Sparkles
            className={`absolute inset-0 ${compact ? "h-4 w-4" : "h-5 w-5"} animate-ping text-fuchsia-300/60`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={[
              "font-semibold text-fuchsia-100",
              compact ? "text-[12px]" : "text-sm",
            ].join(" ")}
          >
            {status === "queued"
              ? t("ingest.queued", { defaultValue: "Queued for processing…" })
              : t("ingest.processing", { defaultValue: "Generating your card…" })}
          </p>
          <p
            className={[
              "truncate text-fuchsia-200/70",
              compact ? "text-[10px]" : "text-xs",
            ].join(" ")}
          >
            {phases[phaseIdx]}
          </p>
        </div>
        <Loader2
          className={[
            "flex-shrink-0 animate-spin text-fuchsia-300",
            compact ? "h-3.5 w-3.5" : "h-4 w-4",
          ].join(" ")}
        />
      </div>

      {/* Thumbnail / hero block */}
      {thumbnailUrl ? (
        <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl bg-ink-800">
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover opacity-70" />
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      ) : (
        <div
          className={[
            "mb-4 w-full overflow-hidden rounded-xl bg-ink-800",
            compact ? "aspect-video" : "aspect-[16/8]",
          ].join(" ")}
        >
          <div className="h-full w-full animate-shimmer bg-gradient-to-r from-ink-800 via-ink-700/60 to-ink-800" />
        </div>
      )}

      {/* Title — real if known, otherwise shimmer */}
      {title ? (
        <h2
          className={[
            "mb-3 font-semibold leading-snug text-ink-100",
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

      {/* Tag pills */}
      <div className="mb-5 flex flex-wrap gap-1.5">
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
    </div>
  );
}

/* --------------------------- primitives --------------------------- */

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 animate-shimmer rounded bg-gradient-to-r from-ink-800 via-ink-700 to-ink-800"
      style={{ width }}
    />
  );
}

function SkeletonPill({ width }: { width: number }) {
  return (
    <div
      className="h-5 animate-shimmer rounded-full bg-gradient-to-r from-ink-800 via-ink-700 to-ink-800"
      style={{ width: `${width}px` }}
    />
  );
}

function SkeletonBullet({ width }: { width: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-600" />
      <div
        className="h-3 animate-shimmer rounded bg-gradient-to-r from-ink-800 via-ink-700 to-ink-800"
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
    <section className="mb-5">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
