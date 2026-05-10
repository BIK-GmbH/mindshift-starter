import { Hash, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Touch-only horizontal swipe wrapper for library card rows.
 *
 *   ← swipe-left  → reveal a red "Delete" lane, commit triggers onDelete
 *   → swipe-right → reveal a sky "Tag" lane, commit triggers onTagPick
 *
 * Disabled on hover-capable pointers (desktop / trackpad) so a click
 * still works as before. Vertical scrolling stays smooth — once the
 * gesture tips horizontal the row claims the swipe via `touch-action`.
 */

interface Props {
  /** The card row content — usually <CardRow /> + its <li>. */
  children: ReactNode;
  onDelete: () => void;
  onTagPick: () => void;
}

const COMMIT_THRESHOLD_FRACTION = 0.32;
const VERTICAL_TOLERANCE = 14;

export default function SwipeableCardRow({ children, onDelete, onTagPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const lockedHorizontal = useRef(false);
  const lockedVertical = useRef(false);
  const widthRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isTouchPrimary =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  useEffect(() => {
    if (!isTouchPrimary) return;
    const el = surfaceRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      lockedHorizontal.current = false;
      lockedVertical.current = false;
      widthRef.current = el.getBoundingClientRect().width;
      setAnimating(false);
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;

      if (!lockedHorizontal.current && !lockedVertical.current) {
        if (Math.abs(dy) > VERTICAL_TOLERANCE && Math.abs(dy) > Math.abs(dx)) {
          lockedVertical.current = true;
          return;
        }
        if (Math.abs(dx) > VERTICAL_TOLERANCE && Math.abs(dx) > Math.abs(dy)) {
          lockedHorizontal.current = true;
        } else {
          return;
        }
      }
      if (lockedVertical.current) return;

      // Damp the motion past the threshold so it feels rubbery, not loose.
      const max = widthRef.current * 0.85;
      const clamped = Math.max(-max, Math.min(max, dx));
      setOffset(clamped);
      e.preventDefault();
    };

    const onEnd = () => {
      // No manual tap handling: vertical scrolls and pure taps both
      // leave lockedHorizontal=false. We let the underlying button's
      // native click event fire (the browser already suppresses click
      // when the touch moved more than its slop threshold, which keeps
      // a vertical scroll from also opening the card).
      if (!lockedHorizontal.current) {
        setOffset(0);
        return;
      }
      const threshold = widthRef.current * COMMIT_THRESHOLD_FRACTION;
      setAnimating(true);
      if (offset <= -threshold) {
        // Swipe-left commit: animate the row out of view, then trigger delete.
        setOffset(-widthRef.current);
        window.setTimeout(() => {
          setCollapsed(true);
          window.setTimeout(() => onDelete(), 120);
        }, 200);
      } else if (offset >= threshold) {
        // Swipe-right commit: snap back; the picker modal opens on top.
        setOffset(0);
        onTagPick();
      } else {
        setOffset(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [isTouchPrimary, offset, onDelete, onTagPick]);

  if (!isTouchPrimary) {
    return <>{children}</>;
  }

  const leftLaneActive = offset > 8;
  const rightLaneActive = offset < -8;

  return (
    <div
      ref={wrapRef}
      className={[
        "relative overflow-hidden transition-[max-height,opacity] duration-150",
        collapsed ? "max-h-0 opacity-0" : "max-h-[280px] opacity-100",
      ].join(" ")}
    >
      {/* Right-swipe lane (revealed on left) — Tag */}
      <div
        aria-hidden
        className={[
          "absolute inset-y-0 left-0 flex w-full items-center justify-start gap-2 px-5 text-sm font-semibold text-sky-100",
          "bg-sky-600/80",
          leftLaneActive ? "opacity-100" : "opacity-0",
          "transition-opacity",
        ].join(" ")}
      >
        <Hash className="h-4 w-4" />
        <span>Tag</span>
      </div>
      {/* Left-swipe lane (revealed on right) — Delete */}
      <div
        aria-hidden
        className={[
          "absolute inset-y-0 right-0 flex w-full items-center justify-end gap-2 px-5 text-sm font-semibold text-red-50",
          "bg-red-600/85",
          rightLaneActive ? "opacity-100" : "opacity-0",
          "transition-opacity",
        ].join(" ")}
      >
        <span>Löschen</span>
        <Trash2 className="h-4 w-4" />
      </div>

      <div
        ref={surfaceRef}
        style={{
          transform: `translate3d(${offset}px,0,0)`,
          touchAction: lockedHorizontal.current ? "pan-y" : "pan-y",
          transition: animating ? "transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1)" : "none",
        }}
        className="relative bg-ink-900"
      >
        {children}
      </div>
    </div>
  );
}
