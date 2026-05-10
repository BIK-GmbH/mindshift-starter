import type { FC, ReactNode } from "react";

/**
 * Shared page-header band. Replaces the per-page mix of plain-title,
 * icon + title, and back-button + title patterns with one consistent
 * structure: colored icon square on the left, title + optional
 * subtitle in the middle, optional action(s) on the right.
 *
 * Pages render different brand colors so the user can tell at a
 * glance which surface they're on without reading the title:
 *
 *   Library    → ink (neutral hub)
 *   Paths      → fuchsia
 *   Podcasts   → sky
 *   Chat       → emerald
 *   Graph      → violet
 *   Review     → amber
 *   Feeds      → orange
 *
 * Mobile inherits the global `.page-header` overrides set in
 * index.html (height 56 px, lateral padding 12 px, title 17 px).
 * Desktop keeps the 92 px / 32 px / 24 px values.
 */

export type PageHeaderTone =
  | "ink"
  | "fuchsia"
  | "sky"
  | "emerald"
  | "violet"
  | "amber"
  | "orange";

interface Props {
  icon: FC<{ className?: string }>;
  tone: PageHeaderTone;
  title: ReactNode;
  /** Plain text or rich React node (e.g. counts strip on the library). */
  subtitle?: ReactNode;
  /** Right-aligned action area — typically a single Plus button. */
  action?: ReactNode;
}

const TONE_CLASSES: Record<PageHeaderTone, { bg: string; ring: string; fg: string }> = {
  ink: {
    bg: "bg-ink-700/60",
    ring: "ring-ink-700",
    fg: "text-ink-100",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/15",
    ring: "ring-fuchsia-500/30",
    fg: "text-fuchsia-300",
  },
  sky: {
    bg: "bg-sky-500/15",
    ring: "ring-sky-500/30",
    fg: "text-sky-300",
  },
  emerald: {
    bg: "bg-emerald-500/15",
    ring: "ring-emerald-500/30",
    fg: "text-emerald-300",
  },
  violet: {
    bg: "bg-violet-500/15",
    ring: "ring-violet-500/30",
    fg: "text-violet-300",
  },
  amber: {
    bg: "bg-amber-500/15",
    ring: "ring-amber-500/30",
    fg: "text-amber-300",
  },
  orange: {
    bg: "bg-orange-500/15",
    ring: "ring-orange-500/30",
    fg: "text-orange-300",
  },
};

export default function PageHeader({ icon: Icon, tone, title, subtitle, action }: Props) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="page-header">
      <div className="page-header-inner flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <div
            className={[
              "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1",
              t.bg,
              t.ring,
            ].join(" ")}
          >
            <Icon className={["h-4 w-4", t.fg].join(" ")} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="page-header-title">{title}</h1>
            {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
