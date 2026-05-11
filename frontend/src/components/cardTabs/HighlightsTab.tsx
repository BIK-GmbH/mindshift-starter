import { ExternalLink, Highlighter, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import VoiceRecordButton from "../VoiceRecordButton";
import { useDialog } from "../../lib/DialogContext";
import { api, type HighlightOut } from "../../lib/api";
import { insertAtCaret } from "../../lib/insertAtCaret";

const HIGHLIGHT_COLORS: { value: string; label: string; ring: string; bar: string }[] = [
  { value: "yellow", label: "Yellow", ring: "ring-amber-400", bar: "bg-amber-400" },
  { value: "green", label: "Green", ring: "ring-emerald-400", bar: "bg-emerald-400" },
  { value: "blue", label: "Blue", ring: "ring-sky-400", bar: "bg-sky-400" },
  { value: "pink", label: "Pink", ring: "ring-pink-400", bar: "bg-pink-400" },
];

function colorBar(color: string): string {
  return (
    HIGHLIGHT_COLORS.find((c) => c.value === color)?.bar ?? "bg-amber-400"
  );
}

interface Props {
  cardId: string;
  /** Source URL of the card — used to build a TextFragment deep-link
   *  back to the original page when the user clicks a highlight. */
  sourceUrl: string | null;
}

/**
 * Read-mostly view of a card's highlights. The actual *creation* path
 * runs through the browser-extension content script — within the
 * main app there's no original-page DOM to highlight against, so we
 * cap functionality here at view + edit-note + recolor + delete.
 */
export default function HighlightsTab({ cardId, sourceUrl }: Props) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [items, setItems] = useState<HighlightOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await api.listCardHighlights(cardId);
        if (!cancelled) setItems(list);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const remove = async (id: string) => {
    const ok = await confirm({
      title:
        t("card.highlightsRemoveTitle", { defaultValue: "Delete this highlight?" }) ??
        "Delete this highlight?",
      body:
        t("card.highlightsRemoveBody", {
          defaultValue: "The highlight is removed everywhere — including on the original page.",
        }) ?? "",
      confirmLabel: t("common.delete") ?? "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteHighlight(id);
      setItems((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const recolor = async (h: HighlightOut, color: string) => {
    if (h.color === color) return;
    setItems((prev) =>
      prev.map((x) => (x.id === h.id ? { ...x, color } : x)),
    );
    try {
      await api.updateHighlight(h.id, { color });
    } catch (err) {
      // Revert
      setItems((prev) => prev.map((x) => (x.id === h.id ? { ...x, color: h.color } : x)));
      setError((err as Error).message);
    }
  };

  const updateNote = async (h: HighlightOut, note: string) => {
    setItems((prev) => prev.map((x) => (x.id === h.id ? { ...x, note } : x)));
    try {
      await api.updateHighlight(h.id, { note });
    } catch {
      /* surface failure on next reload — hold the optimistic state
         so the user keeps typing */
    }
  };

  /** Build a TextFragment URL: `<source>#:~:text=<encoded anchor>`.
   *  Most modern browsers (Chrome 90+, Edge, Brave; Safari 16.4+)
   *  scroll the page to that text on landing. Falls back to plain
   *  navigation if unsupported. */
  const fragmentUrl = (h: HighlightOut): string | null => {
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
    const anchor = h.anchor_text.replace(/\s+/g, " ").trim().slice(0, 100);
    const fragment = `#:~:text=${encodeURIComponent(anchor)}`;
    return sourceUrl + fragment;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("card.highlightsLoading", { defaultValue: "Loading highlights…" })}
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/40 px-5 py-8 text-sm text-ink-400">
        <Highlighter className="h-5 w-5 text-ink-500" />
        <p className="font-medium text-ink-300">
          {t("card.highlightsEmptyTitle", { defaultValue: "No highlights yet" })}
        </p>
        <p className="text-xs text-ink-500">
          {t("card.highlightsEmptyBody", {
            defaultValue:
              "Open the original page with the Mindshift browser extension installed, select text, and click the highlight pill that appears.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        {t("card.highlightsLead", {
          count: items.length,
          defaultValue: "{{count}} quotes saved from this page.",
        })}
      </p>
      {items.map((h) => (
        <article
          key={h.id}
          className="group relative flex gap-3 rounded-lg border border-ink-700 bg-ink-900/40 p-3"
        >
          <span
            className={[
              "block w-1 flex-shrink-0 rounded-full",
              colorBar(h.color),
            ].join(" ")}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-relaxed text-ink-100">
              {h.prefix && (
                <span className="text-ink-500">{h.prefix}</span>
              )}
              <span
                className={[
                  "rounded px-0.5",
                  h.color === "yellow"
                    ? "bg-amber-400/20"
                    : h.color === "green"
                      ? "bg-emerald-400/20"
                      : h.color === "blue"
                        ? "bg-sky-400/20"
                        : h.color === "pink"
                          ? "bg-pink-400/20"
                          : "bg-amber-400/20",
                ].join(" ")}
              >
                {h.anchor_text}
              </span>
              {h.suffix && (
                <span className="text-ink-500">{h.suffix}</span>
              )}
            </p>

            <NoteField
              note={h.note}
              onCommit={(next) => void updateNote(h, next)}
            />

            <div className="mt-2 flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => void recolor(h, c.value)}
                  title={c.label}
                  className={[
                    "h-4 w-4 rounded-full ring-2 transition",
                    c.bar,
                    h.color === c.value ? c.ring : "ring-transparent",
                  ].join(" ")}
                />
              ))}
              <span className="ml-auto inline-flex items-center gap-2 text-[10px] text-ink-500">
                {fragmentUrl(h) && (
                  <a
                    href={fragmentUrl(h)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-ink-800 hover:text-ink-200"
                    title={t("card.highlightsOpenSource", {
                      defaultValue: "Open original page at this highlight",
                    }) ?? ""}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("card.highlightsOpenSourceShort", { defaultValue: "Source" })}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void remove(h.id)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300"
                  title={t("common.delete") ?? "Delete"}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function NoteField({
  note,
  onCommit,
}: {
  note: string;
  onCommit: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(note);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(note), [note]);

  const onVoice = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      const { next, caret } = insertAtCaret(ta, draft, text);
      setDraft(next);
      if (next !== note) onCommit(next);
      setTimeout(() => {
        if (ta) {
          ta.setSelectionRange(caret, caret);
          ta.focus();
        }
      }, 0);
    },
    [draft, note, onCommit],
  );

  return (
    <div className="mt-2 space-y-1">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== note) onCommit(draft);
        }}
        placeholder={
          t("card.highlightsNotePlaceholder", {
            defaultValue: "Annotate this quote (optional)…",
          }) ?? ""
        }
        className="w-full resize-y rounded border border-transparent bg-transparent px-2 py-1 text-[12px] italic leading-relaxed text-ink-300 transition focus:border-ink-700 focus:bg-ink-900/60 focus:not-italic focus:outline-none"
      />
      <div className="flex justify-end">
        <VoiceRecordButton onTranscribed={onVoice} showStatusLine={true} />
      </div>
    </div>
  );
}
