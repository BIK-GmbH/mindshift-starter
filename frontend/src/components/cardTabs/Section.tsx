import type { FC, ReactNode } from "react";

interface SectionProps {
  icon: FC<{ className?: string }>;
  label: string;
  children: ReactNode;
}

export function Section({ icon: Icon, label, children }: SectionProps) {
  return (
    <section>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      {children}
    </section>
  );
}

export function SkeletonLines() {
  return (
    <div className="space-y-2">
      {[100, 95, 88, 92, 70, 96, 60].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-ink-800/70"
          style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
