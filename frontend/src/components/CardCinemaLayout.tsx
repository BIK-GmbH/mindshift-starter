/* Card body layout with two video viewing modes.
 *
 *   dock     — sticky left column (md+), content right. On mobile
 *              the video stacks above the content as a natural flow.
 *   theater  — full-width video pinned to the top of the viewport
 *              while the user scrolls through the content below.
 *
 * Used by the public card surfaces (PublicCardPage and
 * PublicTagPage::CardDetailBody). The previous "float" / draggable
 * mini-player mode was removed because the sticky behaviour in both
 * dock and theater modes already keeps the video reachable while
 * scrolling — the extra complexity wasn't pulling its weight.
 */

import { Maximize2, Minimize2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type VideoMode = "dock" | "theater";

interface Props {
  /** Render-prop for the video frame. Receives the current mode so
   *  the iframe can size correctly per layout. */
  video: (mode: VideoMode) => ReactNode;
  /** Markdown body — TL;DR, takeaways, summary, notes. */
  children: ReactNode;
}

export default function CardCinemaLayout({ video, children }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoMode>("dock");

  // Single mode-toggle in the top-right corner of the video. Icon
  // flips between Maximize2 (dock → click to expand) and Minimize2
  // (theater → click to collapse).
  const renderModeControls = () => (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1">
      <button
        type="button"
        onClick={() => setMode(mode === "theater" ? "dock" : "theater")}
        title={
          mode === "theater"
            ? t("cinema.dock", { defaultValue: "Andocken" }) ?? ""
            : t("cinema.theater", { defaultValue: "Theater-Modus" }) ?? ""
        }
        aria-label={
          mode === "theater"
            ? t("cinema.dock", { defaultValue: "Andocken" }) ?? ""
            : t("cinema.theater", { defaultValue: "Theater-Modus" }) ?? ""
        }
        className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/80 text-ink-200 backdrop-blur transition hover:bg-ink-800/95 hover:text-ink-100"
      >
        {mode === "theater" ? (
          <Minimize2 className="h-3 w-3" />
        ) : (
          <Maximize2 className="h-3 w-3" />
        )}
      </button>
    </div>
  );

  if (mode === "theater") {
    // Sticky-top theater: the video stays pinned at the top of the
    // viewport while the user scrolls the content below. We cap the
    // height at 55vh so the body still has room to breathe on tall
    // monitors — at 1440×900 a 16:9 video at full width would
    // otherwise consume ~80vh.
    return (
      <div className="space-y-5">
        <div className="sticky top-0 z-20 -mx-3 bg-ink-900/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div
            className="relative mx-auto"
            style={{ width: "min(100%, calc(55vh * 16 / 9))" }}
          >
            <div className="aspect-video w-full">{video("theater")}</div>
            {renderModeControls()}
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    );
  }

  // dock (default): 2-col on md+, stacked on mobile. The video is
  // sticky-top in the left column so it stays visible while the
  // user scrolls through the body on the right.
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="md:sticky md:top-4 md:self-start">
        <div className="relative">
          {video("dock")}
          {renderModeControls()}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
