import { Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type Connection, type ConnectionReason } from "../../lib/api";

interface Props {
  cardId: string;
  /** Called with the picked connection's card id so the parent can
   *  navigate or swap the open card. */
  onPick: (cardId: string) => void;
}

/** Pretty colour per reason kind — keeps the chip strip scannable.
 *  Mirrors the GraphPage's edge-signal palette so the user builds
 *  consistent muscle memory across surfaces. */
const REASON_TONE: Record<ConnectionReason["kind"], string> = {
  semantic: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  entity: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  tag: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  relation: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

/**
 * Wide-form related-cards view for the main app's card detail. The
 * side-panel embed has a horizontally scrolling strip; here we have
 * room for a 2-column grid and every reason chip.
 *
 * Read-only — the actual connection scoring is computed by the
 * backend's edge engine on each /connections request, so the only
 * client work is rendering and routing clicks back to the parent.
 */
export default function RelatedTab({ cardId, onPick }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems(null);
    void (async () => {
      try {
        // 20 instead of 5 — wide-form view can show all of them, and
        // a few extras lets the user see weaker connections too.
        const result = await api.cardConnections(cardId, 20);
        if (!cancelled) setItems(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("card.relatedLoading", { defaultValue: "Computing connections…" })}
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-5 py-8 text-sm text-ink-400">
        <Link2 className="h-5 w-5 text-ink-500" />
        <p className="font-medium text-ink-300">
          {t("card.relatedEmptyTitle", { defaultValue: "No connections yet" })}
        </p>
        <p className="text-xs text-ink-500">
          {t("card.relatedEmptyBody", {
            defaultValue:
              "Save more cards on related topics — the edge engine surfaces semantic similarity, shared entities, shared tags, and manual relations once the library has neighbours.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        {t("card.relatedLead", {
          count: items.length,
          defaultValue: "{{count}} cards your library connects to this one.",
        })}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((c) => (
          <button
            key={c.card_id}
            type="button"
            onClick={() => onPick(c.card_id)}
            className="group flex gap-3 rounded-lg border border-ink-700 bg-ink-900/40 p-3 text-left transition hover:border-ink-500 hover:bg-ink-900/70"
          >
            {c.thumbnail_url ? (
              <img
                src={c.thumbnail_url}
                alt=""
                className="h-16 w-24 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
              />
            ) : (
              <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-md bg-ink-800 text-[9px] uppercase tracking-wider text-ink-500 ring-1 ring-ink-700">
                {c.source_type}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 text-sm font-medium leading-tight text-ink-100 group-hover:text-white">
                  {c.title}
                </p>
                <ScorePill score={c.score} />
              </div>
              {c.reasons.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.reasons.map((r, i) => (
                    <span
                      key={i}
                      title={r.label}
                      className={[
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                        REASON_TONE[r.kind] ?? "bg-ink-800 text-ink-300 ring-ink-700",
                      ].join(" ")}
                    >
                      {r.kind}
                    </span>
                  ))}
                </div>
              )}
              {c.tags.length > 0 && (
                <p className="mt-1.5 truncate text-[10px] text-ink-500">
                  {c.tags.slice(0, 4).map((tag) => `#${tag}`).join(" ")}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Score badge — visualises the edge-engine score (0..1) as a tiny
 * filled bar. We avoid rendering the raw number because users were
 * confused by "0.42" not meaning "42%": the score is a relative
 * weight, not a probability. The bar conveys "more vs less" without
 * inviting that misreading.
 */
function ScorePill({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const pct = Math.round(clamped * 100);
  return (
    <div
      className="flex h-1 w-12 flex-shrink-0 overflow-hidden rounded-full bg-ink-800"
      title={`Score ${score.toFixed(2)}`}
    >
      <div
        className="h-full bg-ink-300 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
