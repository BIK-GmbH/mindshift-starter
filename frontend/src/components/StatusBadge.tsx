import { useTranslation } from "react-i18next";

import type { CardStatus } from "../lib/api";

const styles: Record<CardStatus, string> = {
  queued: "bg-ink-700 text-ink-200",
  processing: "bg-amber-500/20 text-amber-300",
  completed: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-red-500/20 text-red-300",
};

export default function StatusBadge({ status }: { status: CardStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[status]}`}>
      {t(`card.status.${status}`)}
    </span>
  );
}
