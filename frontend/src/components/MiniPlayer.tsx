import { GripVertical, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Floating YouTube mini-player used in the Review session so the user
 * can keep an eye on the source video while quizzing without leaving
 * the queue. Strictly scoped to the review flow — not mounted globally.
 *
 * - 320×180 (16:9), fixed size on desktop. Hidden on `<md` because a
 *   draggable window on a phone screen is friction with no payoff.
 * - Drag-handle is the header strip. Position persists in localStorage
 *   so the next session opens the player where the user last left it.
 * - YouTube embed uses the standard /embed URL with no `autoplay`.
 *   The parent controls *which* video by passing `videoId`; updates to
 *   that prop swap the iframe src in place, matching the user's
 *   request that the player follows the queue's current card.
 */

const STORAGE_KEY = "mindshift.miniplayer.position";
const WIDTH = 320;
const HEIGHT = 220; // 180 video + 40 header

interface Position {
  x: number;
  y: number;
}

function loadPosition(): Position {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Position;
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y)
      ) {
        return parsed;
      }
    }
  } catch {
    /* fall through to default */
  }
  // Default: bottom-right with a comfortable margin.
  const x =
    typeof window !== "undefined" ? window.innerWidth - WIDTH - 24 : 24;
  const y =
    typeof window !== "undefined" ? window.innerHeight - HEIGHT - 80 : 24;
  return { x: Math.max(8, x), y: Math.max(8, y) };
}

function savePosition(pos: Position): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* localStorage full or disabled — ignore, position just won't persist */
  }
}

function clampToViewport(pos: Position): Position {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(8, window.innerWidth - WIDTH - 8);
  const maxY = Math.max(8, window.innerHeight - HEIGHT - 8);
  return {
    x: Math.min(Math.max(8, pos.x), maxX),
    y: Math.min(Math.max(8, pos.y), maxY),
  };
}

interface Props {
  videoId: string;
  title: string;
  onClose: () => void;
}

export default function MiniPlayer({ videoId, title, onClose }: Props) {
  const [pos, setPos] = useState<Position>(() => clampToViewport(loadPosition()));
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);

  // Persist whenever the position changes (debounced via React batching).
  useEffect(() => {
    savePosition(pos);
  }, [pos]);

  // Re-clamp on resize so the player can't end up off-screen after the
  // window shrinks.
  useEffect(() => {
    function onResize() {
      setPos((p) => clampToViewport(p));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only react to the drag handle, not the close button.
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setPos(
      clampToViewport({
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY,
      }),
    );
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer might already be released — non-fatal */
    }
  }

  return createPortal(
    <div
      className="fixed z-50 hidden flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl md:flex"
      style={{
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT,
      }}
      role="dialog"
      aria-label={`Mini-Player: ${title}`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex h-10 cursor-grab select-none items-center justify-between gap-2 border-b border-ink-700 bg-ink-800/80 px-2 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-ink-300">
          <GripVertical className="h-4 w-4 flex-shrink-0 text-ink-500" />
          <span className="min-w-0 truncate text-xs" title={title}>
            {title}
          </span>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={onClose}
          aria-label="Close mini-player"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-700 hover:text-ink-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <iframe
        // `key` on videoId forces a fresh iframe whenever the queue
        // moves to a different video — guarantees the player swaps
        // cleanly instead of trying to mutate state inside the embed.
        key={videoId}
        src={`https://www.youtube.com/embed/${videoId}?modestbranding=1&rel=0`}
        title={title}
        className="h-full w-full border-0"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>,
    document.body,
  );
}
