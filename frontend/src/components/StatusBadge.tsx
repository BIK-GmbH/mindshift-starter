import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CardStatus } from "../lib/api";

const styles: Record<CardStatus, string> = {
  queued: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  processing: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40",
  completed: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
};

export default function StatusBadge({ status }: { status: CardStatus }) {
  const { t } = useTranslation();
  const inflight = status === "queued" || status === "processing";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[status]}`}
    >
      {inflight && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {t(`card.status.${status}`)}
    </span>
  );
}
