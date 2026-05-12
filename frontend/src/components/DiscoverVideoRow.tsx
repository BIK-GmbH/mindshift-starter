/* Library-style row for a YouTube suggestion on the Discover page.
 *
 * Looks like LibraryPage's <CardRow> but with a Play overlay on the
 * thumbnail. Click play → row expands and a privacy-enhanced YouTube
 * iframe takes over the thumbnail slot so the user can pre-screen
 * the video before deciding whether to save it.
 *
 * "Save to Mindshift" piggybacks on /api/cards/from-youtube — no
 * special flow.
 */

import { Check, ExternalLink, Loader2, Pause, Play, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type YouTubeSuggestion } from "../lib/api";

interface Props {
  item: YouTubeSuggestion;
  /** True when this row's player is currently active. Owned by the
   *  parent so only one row plays at a time. */
  playing: boolean;
  /** Toggle play state from this row. Parent decides whether to also
   *  stop a different row that was playing. */
  onTogglePlay: () => void;
  onSaved?: (cardId: string, videoId: string) => void;
}

export default function DiscoverVideoRow({ item, playing, onTogglePlay, onSaved }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCardId, setSavedCardId] = useState<string | null>(
    item.already_saved_card_id,
  );
  // True once the user has hit Play at least once. We then keep the
  // iframe mounted (toggling its `src` between the embed URL and
  // about:blank) so the YouTube player's audio fully stops on Stop —
  // pure conditional rendering leaves buffered audio playing in some
  // browsers for a few seconds after unmount.
  const [hasEverPlayed, setHasEverPlayed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const watchUrl = `https://www.youtube.com/watch?v=${item.video_id}`;
  const embedSrc = `https://www.youtube-nocookie.com/embed/${item.video_id}?autoplay=1&modestbranding=1&rel=0`;
  const isSaved = !!savedCardId;

  useEffect(() => {
    if (playing) setHasEverPlayed(true);
    // When the parent flips `playing` to false, explicitly point the
    // iframe at about:blank so the audio stops immediately (some
    // browsers keep playing for a second or two after just hiding it).
    if (!playing && iframeRef.current) {
      try {
        iframeRef.current.src = "about:blank";
      } catch {
        // src assignment never throws in practice; the try/catch is
        // just defensive against unexpected iframe states.
      }
    }
  }, [playing]);

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
    <li
      className={[
        "group border-b border-ink-800/70 last:border-b-0 transition",
        isSaved ? "opacity-70" : "",
      ].join(" ")}
    >
      {/* Mobile: stacked layout (thumbnail full-width on top).
       *  Desktop (sm+): horizontal row. The thumbnail's aspect-video
       *  on mobile keeps the touch target generous and matches the
       *  YouTube watch-app feel. */}
      <div className="flex w-full flex-col gap-3 px-4 py-4 sm:flex-row sm:items-stretch sm:gap-5 sm:px-5 sm:py-4">
        {/* Thumbnail + player live in the same box so the layout
         *  doesn't reflow when the user toggles play. Once played at
         *  least once, the iframe stays mounted so we can yank its
         *  `src` to about:blank on Stop — that fully kills the audio
         *  immediately (pure unmount leaves it humming for a beat). */}
        <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden rounded-md ring-1 ring-ink-700 sm:aspect-auto sm:h-[126px] sm:w-[224px]">
          {hasEverPlayed && (
            <iframe
              ref={iframeRef}
              src={playing ? embedSrc : "about:blank"}
              title={item.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className={[
                "absolute inset-0 h-full w-full",
                playing ? "z-10" : "z-0 opacity-0 pointer-events-none",
              ].join(" ")}
            />
          )}
          {!playing && (
            <>
              {item.thumbnail_url ? (
                <img
                  src={item.thumbnail_url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-ink-800 text-[10px] text-ink-500">
                  YouTube
                </div>
              )}
              {/* Play overlay — always visible on touch (small screens
               *  can't hover) and a hover-reveal on desktop so the
               *  thumbnail isn't visually noisy in a long list. */}
              <button
                type="button"
                onClick={onTogglePlay}
                aria-label={t("discoverRow.play", { defaultValue: "Vorschau abspielen" }) ?? ""}
                className="absolute inset-0 flex items-center justify-center bg-black/20 text-white opacity-100 transition sm:bg-black/30 sm:opacity-0 sm:group-hover:opacity-100 sm:hover:opacity-100"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-ink-900 shadow-lg sm:h-10 sm:w-10">
                  <Play className="h-5 w-5 fill-current" />
                </span>
              </button>
              {item.duration_iso ? (
                <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {formatIsoDuration(item.duration_iso)}
                </span>
              ) : null}
              {isSaved ? (
                <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-ink-900/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-200 ring-1 ring-ink-700">
                  <Check className="h-2.5 w-2.5" />
                  {t("youtube.alreadySaved", { defaultValue: "In Library" })}
                </span>
              ) : null}
            </>
          )}
        </div>

        {/* Title + channel + description */}
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-400">
              YouTube
              <span className="text-ink-600">·</span>
              <span className="text-ink-500 normal-case tracking-normal">
                {item.channel}
              </span>
              {item.published_at ? (
                <>
                  <span className="text-ink-600">·</span>
                  <span className="text-ink-500 normal-case tracking-normal">
                    {formatRelative(item.published_at)}
                  </span>
                </>
              ) : null}
            </div>
            <p
              className={[
                "mt-1 line-clamp-2 text-[15px] font-semibold leading-snug sm:text-base",
                isSaved ? "text-ink-300" : "text-ink-100",
              ].join(" ")}
            >
              {item.title}
            </p>
            {item.description ? (
              <p className="mt-1.5 line-clamp-2 hidden text-[12px] leading-snug text-ink-500 sm:block">
                {item.description}
              </p>
            ) : null}
          </div>
          {error && (
            <p className="mt-1 text-[10px] text-red-300">{error}</p>
          )}
        </div>

        {/* Actions — mobile: horizontal row spanning the row's full
         *  width under the title block. Desktop: a vertical column on
         *  the right with the primary CTA on top and Play/Open as
         *  icon-buttons below. */}
        <div className="flex flex-row items-center justify-between gap-2 sm:flex-shrink-0 sm:flex-col sm:items-end sm:justify-between sm:gap-1.5 sm:py-0.5">
          {isSaved ? (
            <button
              type="button"
              onClick={() => savedCardId && navigate(`/cards/${savedCardId}`)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2.5 py-2 text-[12px] font-medium text-ink-200 transition hover:text-ink-100 sm:flex-none sm:py-1.5 sm:text-[11px]"
            >
              {t("youtube.openCard", { defaultValue: "Karte öffnen" })}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-violet-500 px-2.5 py-2 text-[12px] font-semibold text-white transition hover:bg-violet-400 disabled:opacity-60 sm:flex-none sm:py-1.5 sm:text-[11px]"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-3 sm:w-3" />
              ) : (
                <Plus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
              )}
              {t("youtube.saveToMindshift", { defaultValue: "Speichern" })}
            </button>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onTogglePlay}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:text-ink-100"
              title={
                (playing
                  ? t("discoverRow.stop", { defaultValue: "Stop" })
                  : t("discoverRow.play", { defaultValue: "Vorschau abspielen" })) ?? ""
              }
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener"
              referrerPolicy="strict-origin-when-cross-origin"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:text-ink-100 sm:h-7 sm:w-7"
              title={t("youtube.openInYouTube", { defaultValue: "Auf YouTube öffnen" }) ?? ""}
              aria-label={
                t("youtube.openInYouTube", { defaultValue: "Auf YouTube öffnen" }) ?? ""
              }
            >
              <ExternalLink className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            </a>
          </div>
        </div>
      </div>
    </li>
  );
}

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
