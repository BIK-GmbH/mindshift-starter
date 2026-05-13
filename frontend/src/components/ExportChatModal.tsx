/* Export chat messages → card notes.
 *
 * Opens from the ChatPanel toolbar. User picks which Q/A pairs (or
 * individual messages) to keep, chooses a format, previews the
 * markdown, then appends to the target card's notes_md via a
 * standard PATCH /api/cards/{id}/notes round-trip.
 *
 * Read-modify-write: we re-fetch the card right before saving so we
 * don't clobber an edit made in another tab. The new block is
 * appended below the existing notes with a horizontal-rule separator
 * + an ISO timestamp so the user can later tell chat-exported notes
 * from hand-typed ones.
 */

import { Check, Globe, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type Citation, type WebCitation } from "../lib/api";

export interface ExportableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  webCitations?: WebCitation[];
}

type FormatKind = "qaPairs" | "plain";

interface Props {
  open: boolean;
  onClose: () => void;
  /** All messages currently in the chat panel. */
  messages: ExportableMessage[];
  /** The card whose notes_md will be appended. */
  cardId: string;
  cardTitle: string;
  /** Fired with the updated notes_md after a successful save so the
   *  parent can refresh its in-memory card model without a full reload. */
  onSaved?: (newNotesMd: string) => void;
}

export default function ExportChatModal({
  open,
  onClose,
  messages,
  cardId,
  cardTitle,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [format, setFormat] = useState<FormatKind>("qaPairs");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens — default selection is everything
  // assistant said + the user message right before it. That matches the
  // "I want the whole Q&A" intent without forcing the user to
  // hand-check 20 boxes.
  useEffect(() => {
    if (!open) return;
    const next = new Set<string>();
    for (const m of messages) next.add(m.id);
    setSelected(next);
    setFormat("qaPairs");
    setError(null);
  }, [open, messages]);

  const visibleSelected = useMemo(
    () => messages.filter((m) => selected.has(m.id)),
    [messages, selected],
  );

  const formatted = useMemo(
    () => buildMarkdown(visibleSelected, format),
    [visibleSelected, format],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(messages.map((m) => m.id)));
  const selectNone = () => setSelected(new Set());

  const handleSave = async () => {
    if (visibleSelected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Read-modify-write: re-fetch the current notes so we never
      // overwrite changes made elsewhere.
      const current = await api.getCard(cardId);
      const prev = (current.notes_md || "").trim();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const header = `\n\n---\n\n*${t("chatExport.fromChat", { defaultValue: "From chat" })} — ${stamp}*\n\n`;
      const next = prev ? `${prev}${header}${formatted}` : formatted;
      const updated = await api.updateNotes(cardId, next);
      onSaved?.(updated.notes_md ?? next);
      onClose();
    } catch (err) {
      setError((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">
              {t("chatExport.title", { defaultValue: "Export chat to notes" })}
            </h2>
            <p className="text-[11px] text-ink-400">
              {t("chatExport.target", { defaultValue: "Will be appended to" })}: <span className="text-ink-200">{cardTitle}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 transition hover:text-ink-100"
            aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-ink-800 px-5 py-2.5 text-[11px]">
          <div className="flex items-center gap-3">
            <span className="text-ink-400">
              {t("chatExport.selected", { defaultValue: "Selected" })}: {visibleSelected.length}/{messages.length}
            </span>
            <button type="button" onClick={selectAll} className="text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline">
              {t("chatExport.selectAll", { defaultValue: "All" })}
            </button>
            <button type="button" onClick={selectNone} className="text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline">
              {t("chatExport.selectNone", { defaultValue: "None" })}
            </button>
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-ink-800/60 p-0.5 ring-1 ring-ink-700">
            <FormatButton active={format === "qaPairs"} onClick={() => setFormat("qaPairs")}>
              {t("chatExport.formatQa", { defaultValue: "Q&A pairs" })}
            </FormatButton>
            <FormatButton active={format === "plain"} onClick={() => setFormat("plain")}>
              {t("chatExport.formatPlain", { defaultValue: "Plain" })}
            </FormatButton>
          </div>
        </div>

        {/* Body — two-column on wide enough, stacked on narrow.
         *  Narrow mode: the body itself scrolls and the children size to
         *  their content (no flex-1) so they never overlap. Wide mode:
         *  the body is overflow-hidden, both children get flex-1 with
         *  their own internal scroll. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5 md:flex-row md:overflow-hidden">
          {/* Message picker */}
          <div className="space-y-1.5 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-2">
            {messages.length === 0 && (
              <p className="text-xs text-ink-500">
                {t("chatExport.empty", { defaultValue: "No messages yet — send something first." })}
              </p>
            )}
            {messages.map((m) => {
              const isOn = selected.has(m.id);
              return (
                <label
                  key={m.id}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-snug transition",
                    isOn
                      ? "border-ink-600 bg-ink-800/70"
                      : "border-ink-800 bg-ink-800/30 hover:border-ink-700",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggle(m.id)}
                    className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={[
                        "mb-0.5 inline-block rounded px-1.5 text-[9px] font-semibold uppercase tracking-wider",
                        m.role === "user"
                          ? "bg-ink-100 text-ink-900"
                          : "bg-violet-500/20 text-violet-300",
                      ].join(" ")}
                    >
                      {m.role === "user"
                        ? t("chatExport.you", { defaultValue: "You" })
                        : t("chatExport.assistant", { defaultValue: "Assistant" })}
                    </span>
                    <span className="block whitespace-pre-wrap text-ink-200">
                      {m.content.length > 320 ? m.content.slice(0, 320) + "…" : m.content}
                    </span>
                    {((m.webCitations?.length ?? 0) > 0 || (m.citations?.length ?? 0) > 0) && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-ink-500">
                        {(m.webCitations?.length ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Globe className="h-2.5 w-2.5" />
                            {m.webCitations!.length} {t("chatExport.webSources", { defaultValue: "web" })}
                          </span>
                        )}
                        {(m.citations?.length ?? 0) > 0 && (
                          <span>
                            · {m.citations!.length} {t("chatExport.sources", { defaultValue: "cards" })}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {/* Preview */}
          <div className="flex flex-col rounded-md border border-ink-800 bg-ink-800/30 md:min-h-0 md:flex-1 md:overflow-hidden">
            <div className="border-b border-ink-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {t("chatExport.preview", { defaultValue: "Preview" })}
            </div>
            <pre className="max-h-[40vh] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-200 whitespace-pre-wrap break-words md:max-h-none md:flex-1">
              {formatted || t("chatExport.previewEmpty", { defaultValue: "(nothing selected)" })}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-ink-800 px-5 py-3">
          <p className="text-[11px] text-red-300 min-h-[1em]">{error || ""}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || visibleSelected.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t("chatExport.append", { defaultValue: "Append to notes" })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormatButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition",
        active ? "bg-ink-100 text-ink-900" : "text-ink-400 hover:text-ink-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** Format the selected messages as markdown. Two shapes:
 *  - qaPairs: groups consecutive user→assistant exchanges and uses
 *    "**Q:**" / "**A:**" prefixes for fast scanning.
 *  - plain: a flat list with role badges and no extra structure.
 */
function buildMarkdown(messages: ExportableMessage[], format: FormatKind): string {
  if (messages.length === 0) return "";

  if (format === "qaPairs") {
    const parts: string[] = [];
    for (const m of messages) {
      const prefix = m.role === "user" ? "**Q:**" : "**A:**";
      const body = m.content.trim();
      let block = `${prefix} ${body}`;
      // Append web sources right under the answer they belong to.
      if (m.role === "assistant" && m.webCitations && m.webCitations.length > 0) {
        const lines = m.webCitations.map(
          (w) => `- [${w.title}](${w.url})`,
        );
        block += `\n\n*Web:*\n${lines.join("\n")}`;
      }
      parts.push(block);
    }
    return parts.join("\n\n");
  }

  // plain
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "**You:**" : "**Assistant:**";
    lines.push(`${role} ${m.content.trim()}`);
    if (m.role === "assistant" && m.webCitations && m.webCitations.length > 0) {
      for (const w of m.webCitations) {
        lines.push(`- [${w.title}](${w.url})`);
      }
    }
  }
  return lines.join("\n\n");
}
