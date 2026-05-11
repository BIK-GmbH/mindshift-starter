/**
 * Global toast notifications. Stack-style — toasts pile up bottom-right
 * and auto-dismiss after 5 s. Each toast can carry an action button so
 * we can offer "Open image" / "Retry" / "Undo" right next to the
 * status message.
 *
 * Why home-grown (instead of sonner / react-hot-toast): one less dep,
 * no global selectors to manage, and we already have the
 * design-token / portal scaffolding we need from the dialog system.
 */

import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss after this many ms. `null` = sticky until updated /
   *  dismissed by id. Loading toasts default to sticky. */
  duration: number | null;
  action?: ToastAction;
}

export interface ToastShowOptions {
  /** Reuse an existing toast id to update its kind / message in place.
   *  Lets us start with kind="loading" and flip to "success" / "error"
   *  without stacking. */
  id?: string;
  kind?: ToastKind;
  message: string;
  duration?: number | null;
  action?: ToastAction;
}

interface ToastContextValue {
  show: (options: ToastShowOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;
const newId = () => `t${Date.now().toString(36)}${(++counter).toString(36)}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string, duration: number | null) => {
      clearTimer(id);
      if (duration === null) return;
      const handle = window.setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, handle);
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (options: ToastShowOptions): string => {
      const id = options.id ?? newId();
      const kind: ToastKind = options.kind ?? "info";
      const duration =
        options.duration === undefined
          ? kind === "loading"
            ? null
            : 5000
          : options.duration;
      const toast: Toast = {
        id,
        kind,
        message: options.message,
        duration,
        action: options.action,
      };
      setToasts((prev) => {
        const existing = prev.findIndex((t) => t.id === id);
        if (existing >= 0) {
          const next = prev.slice();
          next[existing] = toast;
          return next;
        }
        return [...prev, toast];
      });
      scheduleAutoDismiss(id, duration);
      return id;
    },
    [scheduleAutoDismiss],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((h) => window.clearTimeout(h));
      timersRef.current.clear();
    },
    [],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icon =
    toast.kind === "success" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
    ) : toast.kind === "error" ? (
      <XCircle className="h-4 w-4 text-red-300" />
    ) : toast.kind === "loading" ? (
      <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
    ) : (
      <Info className="h-4 w-4 text-ink-300" />
    );

  const accent =
    toast.kind === "success"
      ? "border-emerald-500/40"
      : toast.kind === "error"
        ? "border-red-500/40"
        : toast.kind === "loading"
          ? "border-violet-500/40"
          : "border-ink-700";

  return (
    <div
      role="status"
      className={[
        "pointer-events-auto flex items-start gap-2 rounded-lg border bg-ink-900/95 px-3 py-2.5 text-xs text-ink-100 shadow-xl backdrop-blur",
        accent,
      ].join(" ")}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
          className="flex-shrink-0 rounded-md border border-ink-700 px-2 py-0.5 text-[11px] font-medium text-ink-100 transition hover:bg-ink-700"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 rounded-md p-0.5 text-ink-500 transition hover:bg-ink-800 hover:text-ink-200"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
