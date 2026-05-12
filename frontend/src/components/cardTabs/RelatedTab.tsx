import { Library, Link2, Loader2, RefreshCw, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import YouTubeSuggestCard from "../YouTubeSuggestCard";
import {
  api,
  type CardYouTubeSuggestions,
  type Connection,
  type ConnectionReason,
} from "../../lib/api";

type RelatedSource = "library" | "youtube";

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
  const [source, setSource] = useState<RelatedSource>("library");
  const [items, setItems] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // YouTube branch — lazy-loaded on first toggle.
  const [yt, setYt] = useState<CardYouTubeSuggestions | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

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

  // Reset YouTube state on card change so we don't show another
  // card's suggestions during the brief moment before the new fetch
  // resolves.
  useEffect(() => {
    setYt(null);
    setYtError(null);
  }, [cardId]);

  const loadYouTube = async (refresh: boolean) => {
    setYtLoading(true);
    setYtError(null);
    try {
      const res = await api.suggestYouTubeForCard(cardId, refresh);
      setYt(res);
    } catch (err) {
      setYtError((err as Error).message);
    } finally {
      setYtLoading(false);
    }
  };

  const handleSourceChange = (next: RelatedSource) => {
    setSource(next);
    if (next === "youtube" && yt === null && !ytLoading) {
      void loadYouTube(false);
    }
  };

  // Body shared by both branches: a top header with the segment
  // toggle, then the branch-specific content.
  const header = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="inline-flex items-center gap-0.5 rounded-md border border-ink-700 bg-ink-800/60 p-0.5">
        <SegmentButton
          active={source === "library"}
          onClick={() => handleSourceChange("library")}
        >
          <Library className="h-3 w-3" />
          {t("related.fromLibrary", { defaultValue: "Aus Library" })}
        </SegmentButton>
        <SegmentButton
          active={source === "youtube"}
          onClick={() => handleSourceChange("youtube")}
        >
          <Youtube className="h-3 w-3" />
          {t("related.fromYouTube", { defaultValue: "Auf YouTube" })}
        </SegmentButton>
      </div>
      {source === "youtube" && yt && yt.api_enabled && yt.query && (
        <div className="flex items-center gap-2 text-[10px] text-ink-500">
          <span>
            {t("related.queryLabel", { defaultValue: "Query" })}:{" "}
            <span className="text-violet-300">{yt.query}</span>
          </span>
          <button
            type="button"
            onClick={() => void loadYouTube(true)}
            disabled={ytLoading}
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-1.5 py-0.5 text-ink-300 hover:text-ink-100 disabled:opacity-50"
            title={t("related.refresh", { defaultValue: "Refresh" }) ?? ""}
          >
            <RefreshCw
              className={["h-3 w-3", ytLoading ? "animate-spin" : ""].join(" ")}
            />
          </button>
        </div>
      )}
    </div>
  );

  const libraryBranch = (() => {
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
  })();

  const youtubeBranch = (() => {
    if (ytLoading && !yt) {
      return (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("related.ytLoading", { defaultValue: "Suche YouTube-Vorschläge…" })}
        </div>
      );
    }
    if (ytError) {
      return (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {ytError}
        </p>
      );
    }
    if (yt && !yt.api_enabled) {
      return (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-5 py-8 text-sm text-ink-400">
          <p className="font-medium text-ink-300">
            {t("related.ytDisabledTitle", { defaultValue: "YouTube-Vorschläge sind aus" })}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {t("related.ytDisabledBody", {
              defaultValue:
                "Setze YOUTUBE_API_KEY in der .env, um auf Basis der Karten-Tags neue Videos vorzuschlagen.",
            })}
          </p>
        </div>
      );
    }
    if (!yt || yt.results.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-5 py-8 text-sm text-ink-400">
          <p className="font-medium text-ink-300">
            {t("related.ytEmptyTitle", { defaultValue: "Keine Vorschläge gefunden" })}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {t("related.ytEmptyBody", {
              defaultValue:
                "Wenig spezifische Tags an dieser Karte. Vergib ein paar passende Tags und probier es nochmal.",
            })}
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-xs text-ink-500">
          {t("related.ytLead", {
            count: yt.results.length,
            defaultValue:
              "{{count}} Vorschläge · gecached für 24 h · bereits gespeicherte Videos werden markiert.",
          })}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {yt.results.map((r) => (
            <YouTubeSuggestCard
              key={r.video_id}
              item={r}
              onSaved={(savedCardId, videoId) =>
                setYt((prev) =>
                  prev
                    ? {
                        ...prev,
                        results: prev.results.map((it) =>
                          it.video_id === videoId
                            ? { ...it, already_saved_card_id: savedCardId }
                            : it,
                        ),
                      }
                    : prev,
                )
              }
            />
          ))}
        </div>
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      {header}
      {source === "library" ? libraryBranch : youtubeBranch}
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "bg-ink-100 text-ink-900"
          : "text-ink-400 hover:text-ink-100",
      ].join(" ")}
    >
      {children}
    </button>
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
