/* Single video card used by both the per-card Related-tab YouTube
 * sub-toggle and the global Discover page. Two visual states:
 *
 *   - default: thumbnail · title · channel · duration · "+ Save"
 *   - already_saved: subtle dim + "✓ Already in library" badge,
 *     CTA flips to "Open card"
 *
 * Saving piggybacks on the same /api/cards/from-youtube endpoint the
 * extension and `+ Add` modal use — no special flow.
 */

import { Check, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type YouTubeSuggestion } from "../lib/api";

interface Props {
  item: YouTubeSuggestion;
  /** Fires when the user clicks "+ Save" and the backend accepted the
   *  card. Parent can refresh its suggestion list so the now-saved
   *  video flips to "Already in library" without a full refetch. */
  onSaved?: (cardId: string, videoId: string) => void;
}

export default function YouTubeSuggestCard({ item, onSaved }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic local override so the CTA flips immediately after a
  // successful save, even before the parent refetches the list.
  const [savedCardId, setSavedCardId] = useState<string | null>(
    item.already_saved_card_id,
  );

  const watchUrl = `https://www.youtube.com/watch?v=${item.video_id}`;
  const isSaved = !!savedCardId;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.createFromYouTube(watchUrl);
      const newId = res.card.id;
      setSavedCardId(newId);
      onSaved?.(newId, item.video_id);
    } catch (err) {
      setError((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      className={[
        "group flex flex-col overflow-hidden rounded-lg border bg-ink-800/40 transition",
        isSaved
          ? "border-ink-800 opacity-75"
          : "border-ink-800 hover:border-violet-500/40 hover:bg-ink-800/60",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => openWatchInNewTab(watchUrl)}
        className="relative block aspect-video w-full bg-ink-900"
        title={t("youtube.openInYouTube", { defaultValue: "Open in YouTube" }) ?? ""}
      >
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
        {item.duration_iso ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {formatIsoDuration(item.duration_iso)}
          </span>
        ) : null}
        {isSaved ? (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-ink-900/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-200 ring-1 ring-ink-700">
            <Check className="h-2.5 w-2.5" />
            {t("youtube.alreadySaved", { defaultValue: "In Library" })}
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <h3
          className={[
            "line-clamp-2 text-[12.5px] font-medium leading-snug",
            isSaved ? "text-ink-300" : "text-ink-100",
          ].join(" ")}
        >
          {item.title}
        </h3>
        <p className="truncate text-[10px] text-ink-500">
          {item.channel}
          {item.published_at ? ` · ${formatRelative(item.published_at)}` : ""}
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          {isSaved ? (
            <button
              type="button"
              onClick={() => savedCardId && navigate(`/cards/${savedCardId}`)}
              className="flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1.5 text-[11px] font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100"
            >
              {t("youtube.openCard", { defaultValue: "Open card" })}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-ink-100 px-2 py-1.5 text-[11px] font-semibold text-ink-900 shadow-sm transition hover:bg-ink-200 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {t("youtube.saveToMindshift", { defaultValue: "Save" })}
            </button>
          )}
          <button
            type="button"
            onClick={() => openWatchInNewTab(watchUrl)}
            className="rounded-md border border-ink-700 px-2 py-1.5 text-[11px] text-ink-300 transition hover:text-ink-100"
            title={t("youtube.openInYouTube", { defaultValue: "Open in YouTube" }) ?? ""}
            aria-label={t("youtube.openInYouTube", { defaultValue: "Open in YouTube" }) ?? ""}
          >
            ↗
          </button>
        </div>
        {error && (
          <p className="text-[10px] text-red-300">{error}</p>
        )}
      </div>
    </article>
  );
}

/** ISO-8601 duration → "MM:SS" or "H:MM:SS". */
function formatIsoDuration(iso: string): string {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return iso;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(min)}:${pad(s)}`;
  return `${min}:${pad(s)}`;
}

/** See sibling DiscoverVideoRow.openWatchInNewTab for the full reasoning.
 *  TL;DR: detached `<a>`.click() opens a new tab reliably without ever
 *  navigating the current one away from Mindshift. */
function openWatchInNewTab(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Best-effort short relative time, no extra dependency. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(days / 365);
  return `${years} y`;
}
