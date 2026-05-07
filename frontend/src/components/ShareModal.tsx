import { Check, Copy, Link as LinkIcon, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDialog } from "../lib/DialogContext";
import { api } from "../lib/api";

interface Props {
  cardId: string | null;
  onClose: () => void;
}

export default function ShareModal({ cardId, onClose }: Props) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load existing token (if any) when opened
  useEffect(() => {
    if (!cardId) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    api
      .getShare(cardId)
      .then((res) => {
        if (!cancelled) setToken(res?.token ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // ESC closes
  useEffect(() => {
    if (!cardId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardId, onClose]);

  if (!cardId) return null;

  const publicUrl = token
    ? `${window.location.origin}/share/${token}`
    : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createShare(cardId);
      setToken(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: t("share.revokeTitle", { defaultValue: "Revoke this share link?" }),
      body: t("share.revokeBody", {
        defaultValue: "Anyone with the link will lose access. The card itself stays in your library.",
      }),
      confirmLabel: t("share.revoke"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeShare(cardId);
      setToken(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("share.title")}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md modal-backdrop-enter"
      />

      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl modal-card-enter">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-100">{t("share.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-ink-300">
            {t("share.body", {
              defaultValue:
                "Create a public read-only link. Anyone with the link can view the card's summary and notes — no login needed.",
            })}
          </p>

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}

          {publicUrl ? (
            <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2">
              <LinkIcon className="h-3.5 w-3.5 flex-shrink-0 text-ink-400" />
              <span className="flex-1 truncate text-xs text-ink-200">{publicUrl}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-semibold text-ink-900 transition hover:bg-ink-200"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? t("share.copied", { defaultValue: "Copied" }) : t("share.copy", { defaultValue: "Copy" })}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-ink-100 px-4 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              {t("share.create", { defaultValue: "Create share link" })}
            </button>
          )}
        </div>

        {publicUrl && (
          <div className="flex items-center justify-end border-t border-ink-700 bg-ink-900/30 px-5 py-3">
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {t("share.revoke", { defaultValue: "Revoke link" })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
