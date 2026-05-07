import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  body?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogContextValue {
  /** Confirmation dialog. Resolves to true (confirmed) or false (cancelled). */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Prompt dialog. Resolves to the entered string, or null if cancelled. */
  prompt: (opts: PromptOptions) => Promise<string | null>;
  /** Internal — used by the global <DialogHost />. Don't call from app code. */
  _state: DialogState;
  _close: (value: boolean | string | null) => void;
}

type DialogState =
  | { kind: "none" }
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "prompt"; opts: PromptOptions };

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({ kind: "none" });
  const resolverRef = useRef<((v: unknown) => void) | null>(null);

  const close = useCallback((value: boolean | string | null) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState({ kind: "none" });
    r?.(value);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve as (v: unknown) => void;
      setState({ kind: "confirm", opts });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve as (v: unknown) => void;
      setState({ kind: "prompt", opts });
    });
  }, []);

  const value = useMemo(
    () => ({ confirm, prompt, _state: state, _close: close }),
    [confirm, prompt, state, close],
  );

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return { confirm: ctx.confirm, prompt: ctx.prompt };
}

/** Internal hook used only by <DialogHost />. */
export function useDialogHostState() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("DialogHost must be used within DialogProvider");
  return { state: ctx._state, close: ctx._close };
}
