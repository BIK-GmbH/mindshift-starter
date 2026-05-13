/* Card body layout with three video viewing modes.
 *
 *   dock     — sticky left column, content right (desktop default)
 *   theater  — full-width video on top, content below (cinema mode)
 *   float    — video as a draggable picture-in-picture overlay,
 *              content takes full width
 *
 * Used by the public card surfaces (PublicCardPage,
 * PublicTagPage::CardDetailBody). Could be lifted into the in-app
 * CardDetailContent later — the shape (video + content) is the
 * same.
 *
 * Float mode uses pointer events directly rather than HTML5 drag
 * because HTML5 drag has poor browser support inside flex/grid
 * containers and produces a "ghost" drag preview that we'd have to
 * style away. PointerEvents are simpler and consistent across
 * mouse + touch + pen.
 */

import { Maximize2, Minimize2, Move, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

export type VideoMode = "dock" | "theater" | "float";

const FLOAT_DEFAULT_WIDTH = 380;
const FLOAT_DEFAULT_HEIGHT = 214; // 16:9
const FLOAT_MARGIN = 16;

interface Props {
  /** Render-prop for the video frame. Receives the desired width so
   *  iframe can size correctly even in the floating window. */
  video: (mode: VideoMode) => ReactNode;
  /** Markdown body — TL;DR, takeaways, summary, notes. */
  children: ReactNode;
  /** Allow the float mode? Caller can disable on narrow viewports. */
  enableFloat?: boolean;
}

export default function CardCinemaLayout({ video, children, enableFloat = true }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoMode>("dock");

  // Float-window position in viewport pixels. Initialised on first
  // entry into float mode (top-right of the viewport with a margin).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragOriginRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  // Init position when first switching to float — anchor near top-right.
  useEffect(() => {
    if (mode === "float" && !pos) {
      const x = Math.max(
        FLOAT_MARGIN,
        window.innerWidth - FLOAT_DEFAULT_WIDTH - FLOAT_MARGIN,
      );
      const y = FLOAT_MARGIN + 56; // clear the top-bar
      setPos({ x, y });
    }
  }, [mode, pos]);

  // Snap-to-viewport on window resize so a smaller window doesn't
  // hide the float off-screen.
  useEffect(() => {
    if (mode !== "float") return;
    const onResize = () => {
      setPos((p) =>
        p
          ? {
              x: Math.min(
                Math.max(FLOAT_MARGIN, p.x),
                window.innerWidth - FLOAT_DEFAULT_WIDTH - FLOAT_MARGIN,
              ),
              y: Math.min(
                Math.max(FLOAT_MARGIN, p.y),
                window.innerHeight - FLOAT_DEFAULT_HEIGHT - FLOAT_MARGIN,
              ),
            }
          : p,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode]);

  // Track active-drag state so we can disable iframe pointer-events
  // while the user is moving the float window. Without this, once
  // the pointer crosses over the YouTube iframe it captures the
  // event and our drag stops mid-motion.
  const [isDragging, setIsDragging] = useState(false);

  // Drag is wired through document-level listeners on pointerdown
  // so we don't depend on the pointer staying inside the header
  // element. setPointerCapture seemed promising but broke when the
  // pointer crossed the iframe boundary. Document listeners + ref
  // origin make the drag follow the cursor reliably.
  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (!pos) return;
      e.preventDefault();
      dragOriginRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        x: pos.x,
        y: pos.y,
      };
      setIsDragging(true);
    },
    [pos],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragOriginRef.current) return;
      const dx = e.clientX - dragOriginRef.current.pointerX;
      const dy = e.clientY - dragOriginRef.current.pointerY;
      const nx = Math.min(
        Math.max(FLOAT_MARGIN, dragOriginRef.current.x + dx),
        window.innerWidth - FLOAT_DEFAULT_WIDTH - FLOAT_MARGIN,
      );
      const ny = Math.min(
        Math.max(FLOAT_MARGIN, dragOriginRef.current.y + dy),
        window.innerHeight - FLOAT_DEFAULT_HEIGHT - FLOAT_MARGIN,
      );
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragOriginRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging]);

  // Mode-controls overlay rendered on top of the video. Three small
  // pill buttons in the top-right corner — Theater, Float (when
  // permitted), and Minimize (visible in non-dock modes).
  const renderModeControls = (currentMode: VideoMode) => (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1">
      <ModeBtn
        active={currentMode === "theater"}
        onClick={() => setMode(currentMode === "theater" ? "dock" : "theater")}
        title={t("cinema.theater", { defaultValue: "Theater-Modus" })}
      >
        <Maximize2 className="h-3 w-3" />
      </ModeBtn>
      {enableFloat && (
        <ModeBtn
          active={currentMode === "float"}
          onClick={() => setMode(currentMode === "float" ? "dock" : "float")}
          title={t("cinema.float", { defaultValue: "Schwebendes Fenster" })}
        >
          <Move className="h-3 w-3" />
        </ModeBtn>
      )}
      {currentMode !== "dock" && (
        <ModeBtn
          active={false}
          onClick={() => setMode("dock")}
          title={t("cinema.dock", { defaultValue: "Andocken" })}
        >
          <Minimize2 className="h-3 w-3" />
        </ModeBtn>
      )}
    </div>
  );

  if (mode === "theater") {
    // Sticky-top theater: video stays at the top of the viewport
    // while the user scrolls through the content below. We constrain
    // the height to 55vh max so the text underneath still has room
    // to breathe — at very wide viewports the video would otherwise
    // be > 80vh tall and the sticky behaviour becomes useless.
    return (
      <div className="space-y-5">
        <div className="sticky top-0 z-20 -mx-3 bg-ink-900/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div
            className="relative mx-auto"
            style={{
              width: "min(100%, calc(55vh * 16 / 9))",
            }}
          >
            <div className="aspect-video w-full">{video("theater")}</div>
            {renderModeControls("theater")}
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    );
  }

  if (mode === "float") {
    return (
      <>
        {/* Content takes full width while the video floats over it. */}
        <div className="space-y-4">{children}</div>
        {pos && (
          <div
            role="dialog"
            aria-label={t("cinema.float", { defaultValue: "Schwebendes Video" }) ?? ""}
            className={[
              "fixed z-40 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl",
              isDragging ? "select-none" : "",
            ].join(" ")}
            style={{
              left: pos.x,
              top: pos.y,
              width: FLOAT_DEFAULT_WIDTH,
            }}
          >
            <div
              className={[
                "flex h-7 items-center justify-between gap-2 border-b border-ink-800 bg-ink-900/95 px-2 touch-none",
                isDragging ? "cursor-grabbing" : "cursor-grab",
              ].join(" ")}
              onPointerDown={onDragStart}
            >
              <span className="pointer-events-none inline-flex items-center gap-1 text-[10px] text-ink-400">
                <Move className="h-3 w-3" />
                {t("cinema.drag", { defaultValue: "Ziehen" })}
              </span>
              <button
                type="button"
                onClick={() => setMode("dock")}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:text-ink-100"
                aria-label={t("cinema.dock", { defaultValue: "Andocken" }) ?? ""}
                title={t("cinema.dock", { defaultValue: "Andocken" }) ?? ""}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {/* While dragging we disable pointer events on the iframe
             *  so the YouTube player doesn't capture the move and
             *  break the drag mid-motion. */}
            <div
              className={[
                "relative aspect-video w-full bg-ink-950",
                isDragging ? "pointer-events-none" : "",
              ].join(" ")}
            >
              {video("float")}
            </div>
          </div>
        )}
      </>
    );
  }

  // dock (default): 2-col on md+, stacked on mobile. Video sticky-top
  // in the left column.
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="md:sticky md:top-4 md:self-start">
        <div className="relative">
          {video("dock")}
          {renderModeControls("dock")}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md backdrop-blur transition",
        active
          ? "bg-ink-100/90 text-ink-900"
          : "bg-ink-900/80 text-ink-200 hover:bg-ink-800/95 hover:text-ink-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
