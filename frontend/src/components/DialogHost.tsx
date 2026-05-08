import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDialogHostState } from "../lib/DialogContext";

/**
 * Mounts globally and renders a confirm or prompt dialog whenever app code
 * calls `useDialog().confirm(...)` / `.prompt(...)`. Replaces the native
 * `window.confirm` / `window.prompt` so we can style the dialogs to fit.
 */
export default function DialogHost() {
  const { state, close } = useDialogHostState();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  // Sync prompt default value when a new prompt opens.
  useEffect(() => {
    if (state.kind === "prompt") {
      setDraft(state.opts.defaultValue ?? "");
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => window.clearTimeout(id);
    }
  }, [state]);

  // ESC closes (cancel)
  useEffect(() => {
    if (state.kind === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(state.kind === "prompt" ? null : false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  if (state.kind === "none") return null;

  const isConfirm = state.kind === "confirm";
  const opts = state.opts;
  const danger = isConfirm && (opts as { danger?: boolean }).danger === true;

  const onCancel = () => close(state.kind === "prompt" ? null : false);
  const onSubmit = () => close(state.kind === "prompt" ? draft.trim() || null : true);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md modal-backdrop-enter"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 surface-elevated modal-card-enter">
        <div className="flex items-start gap-3 px-5 pt-5">
          {danger && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-ink-100">{opts.title}</h2>
            {opts.body && (
              <p className="mt-1 text-sm text-ink-300">{opts.body}</p>
            )}
          </div>
        </div>

        {state.kind === "prompt" && (
          <div className="px-5 pt-4">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={state.opts.placeholder ?? ""}
              className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink-700 bg-ink-900/30 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-700/40 hover:text-ink-100"
          >
            {opts.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={state.kind === "prompt" && !draft.trim()}
            className={[
              "rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
              danger
                ? "bg-red-500/90 text-white hover:bg-red-500"
                : "bg-ink-100 text-ink-900 hover:bg-ink-200",
            ].join(" ")}
          >
            {opts.confirmLabel ?? (danger ? t("common.delete") : t("common.save"))}
          </button>
        </div>
      </div>
    </div>
  );
}
