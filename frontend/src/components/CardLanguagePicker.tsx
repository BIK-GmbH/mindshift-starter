import { Check, ChevronDown, Languages, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDialog } from "../lib/DialogContext";
import { api, type CardTranslationOut } from "../lib/api";

interface Props {
  cardId: string;
  /** Reports the currently-active translation back to the parent so it
   *  can swap title + summary fields. `null` = show original card. */
  onActive: (tr: CardTranslationOut | null) => void;
  /** When set, the picker auto-selects this language as soon as a
   *  translation in that language reaches `status="ready"`. Used for
   *  the "default translation language" preference — fires once per
   *  mount, after which the user's picker choices win. */
  initialActiveLanguage?: string | null;
}

const POLL_MS = 4000;
const COMMON_LANGUAGES = [
  "Deutsch",
  "English",
  "Français",
  "Español",
  "Italiano",
  "Português",
  "Nederlands",
  "Polski",
  "日本語",
  "中文",
];

export default function CardLanguagePicker({
  cardId,
  onActive,
  initialActiveLanguage,
}: Props) {
  const { t } = useTranslation();
  const { confirm, prompt } = useDialog();
  const [translations, setTranslations] = useState<CardTranslationOut[]>([]);
  const [activeLang, setActiveLang] = useState<string | null>(null); // null = original
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Track whether we've consumed the initial-active-language hint yet.
  // Once the user clicks anything in the picker (or once we activate
  // the requested language), the hint stops applying. Without this
  // gate the user couldn't switch back to "Original" — the next poll
  // cycle would auto-flip them back.
  const initialHintConsumed = useRef(false);

  /** Merge server rows into existing state without nuking optimistic
   *  entries that haven't reached the server yet. Each entry is keyed
   *  by `language` (the server enforces uniqueness on (card_id, language)).
   *  Server rows always win when both sides know about a language —
   *  they have the authoritative status / timestamps. */
  const mergeServerRows = (rows: CardTranslationOut[]) => {
    setTranslations((prev) => {
      const serverLangs = new Set(rows.map((r) => r.language));
      const optimisticOnly = prev.filter((p) => !serverLangs.has(p.language));
      return [...rows, ...optimisticOnly];
    });
  };

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    api
      .listTranslations(cardId)
      .then((rows) => {
        if (!cancelled) mergeServerRows(rows);
      })
      .catch(() => {
        /* card might be too fresh; non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // Push the active translation up whenever it changes / its status flips.
  useEffect(() => {
    if (!activeLang) {
      onActive(null);
      return;
    }
    const tr = translations.find((x) => x.language === activeLang) ?? null;
    onActive(tr && tr.status === "ready" ? tr : null);
  }, [activeLang, translations, onActive]);

  // Auto-activate the initial-language hint once a matching translation
  // is ready. Fires once per mount (initialHintConsumed gate), so a
  // user who clicks back to "Original" can stay there.
  useEffect(() => {
    if (initialHintConsumed.current) return;
    if (!initialActiveLanguage) return;
    const tr = translations.find(
      (x) => x.language === initialActiveLanguage && x.status === "ready",
    );
    if (!tr) return;
    initialHintConsumed.current = true;
    setActiveLang(initialActiveLanguage);
  }, [translations, initialActiveLanguage]);

  // Poll while any translation is processing. The tick itself reschedules
  // — the effect's dep is just whether ANY processing is happening, not
  // each tick's result, so the loop wouldn't auto-restart otherwise.
  //
  // Also poll when an `initialActiveLanguage` hint is set but no matching
  // ready translation has appeared yet. Without this, an auto-translate
  // kicked off by the parent AFTER our initial list fetch never gets
  // surfaced — the parent created the row, but our cache thinks the
  // translation list is empty so we never re-check.
  const hasProcessing = translations.some((t2) => t2.status === "processing");
  const awaitingInitialHint =
    !initialHintConsumed.current &&
    !!initialActiveLanguage &&
    !translations.some(
      (t2) => t2.language === initialActiveLanguage && t2.status === "ready",
    );
  const shouldPoll = hasProcessing || awaitingInitialHint;
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const rows = await api.listTranslations(cardId);
        if (cancelled) return;
        mergeServerRows(rows);
        const stillProcessing = rows.some((r) => r.status === "processing");
        const stillAwaiting =
          !initialHintConsumed.current &&
          !!initialActiveLanguage &&
          !rows.some(
            (r) => r.language === initialActiveLanguage && r.status === "ready",
          );
        if (stillProcessing || stillAwaiting) {
          timer = window.setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    // First tick fires fast (1s) so the user sees the server's
    // initial "processing" → "ready" transition without waiting a
    // full POLL_MS-second cycle. Subsequent ticks back off to
    // POLL_MS to avoid burning the API.
    timer = window.setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [shouldPoll, cardId, initialActiveLanguage]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const startGenerate = async (language: string) => {
    setOpen(false);
    try {
      const tr = await api.createTranslation(cardId, language);
      // Optimistically merge — the polling effect picks up the latest
      // state from subsequent /list responses without overwriting this
      // optimistic row. setActiveLang flips `hasProcessing` true via
      // the new entry, which kicks the polling effect into life with
      // a fast (1 s) first tick.
      setTranslations((prev) => {
        const without = prev.filter((p) => p.language !== language);
        return [...without, tr];
      });
      setActiveLang(language);
    } catch (err) {
      console.error(err);
    }
  };

  const promptCustomLanguage = async () => {
    const language = await prompt({
      title: t("card.translation.customTitle", { defaultValue: "Add language" }) ?? "Add language",
      body:
        t("card.translation.customBody", {
          defaultValue:
            "Type the target language (any natural-language name works, e.g. 'Türkçe', 'Suomi', 'Bahasa Indonesia').",
        }) ?? "",
      placeholder: "Türkçe",
    });
    if (!language) return;
    void startGenerate(language.trim());
  };

  const removeLanguage = async (language: string) => {
    const ok = await confirm({
      title:
        t("card.translation.removeTitle", { defaultValue: "Remove translation?" }) ??
        "Remove translation?",
      body:
        t("card.translation.removeBody", {
          language,
          defaultValue: 'The "{{language}}" translation will be deleted permanently.',
        }) ?? "",
      confirmLabel: t("common.delete") ?? "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTranslation(cardId, language);
      setTranslations((prev) => prev.filter((p) => p.language !== language));
      if (activeLang === language) setActiveLang(null);
    } catch (err) {
      console.error(err);
    }
  };

  const activeTr = activeLang
    ? translations.find((x) => x.language === activeLang)
    : null;
  // Show the spinner whenever we know a translation is in flight —
  // either because the list-entry says status="processing", or
  // because activeLang has been set but the entry hasn't reached our
  // state yet (the optimistic-add fired but a concurrent fetch may
  // have overwritten it before merge logic landed). Without this
  // fallback the user could see a "Deutsch" label with no progress
  // indicator while the backend is still working.
  const isLoading =
    activeLang !== null && (!activeTr || activeTr.status === "processing");
  const triggerLabel = activeLang ?? t("card.translation.original", { defaultValue: "Original" });

  // Suggested languages for the menu = COMMON list minus already-translated.
  const existingLangs = new Set(translations.map((t2) => t2.language));
  const addable = COMMON_LANGUAGES.filter((l) => !existingLangs.has(l));

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/40 px-2 py-1 text-[11px] text-ink-200 transition hover:bg-ink-800"
        title={t("card.translation.tooltip", { defaultValue: "Switch language / translate" }) ?? ""}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-ink-400" />
        ) : (
          <Languages className="h-3 w-3 text-ink-400" />
        )}
        <span className="font-medium">{triggerLabel}</span>
        <ChevronDown className="h-3 w-3 text-ink-400" />
      </button>

      {open && (
        <div className="panel-elevated absolute right-0 top-[calc(100%+4px)] z-30 w-64 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl">
          <div className="max-h-72 overflow-y-auto py-1">
            {/* Original */}
            <button
              type="button"
              onClick={() => {
                initialHintConsumed.current = true;
                setActiveLang(null);
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition",
                activeLang === null
                  ? "bg-ink-800/80 text-ink-100"
                  : "text-ink-200 hover:bg-ink-800/60",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                  activeLang === null
                    ? "border-ink-100 bg-ink-100 text-ink-900"
                    : "border-ink-600 bg-transparent text-transparent",
                ].join(" ")}
              >
                {activeLang === null && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="flex-1 text-left">
                {t("card.translation.original", { defaultValue: "Original" })}
              </span>
            </button>

            {/* Existing translations */}
            {translations.map((tr) => (
              <div
                key={tr.id}
                className={[
                  "group flex items-center gap-2 px-3 py-1.5 text-[11px] transition",
                  activeLang === tr.language
                    ? "bg-ink-800/80 text-ink-100"
                    : "text-ink-200 hover:bg-ink-800/60",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (tr.status === "failed") {
                      // Re-trigger generation.
                      void startGenerate(tr.language);
                      return;
                    }
                    setActiveLang(tr.language);
                    setOpen(false);
                  }}
                  className="flex flex-1 items-center gap-2 text-left"
                  title={
                    tr.status === "failed"
                      ? (tr.error_message ?? "") +
                        " — " +
                        (t("card.translation.clickToRetry", {
                          defaultValue: "Click to retry",
                        }) ?? "Click to retry")
                      : ""
                  }
                >
                  <span
                    className={[
                      "flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                      activeLang === tr.language
                        ? "border-ink-100 bg-ink-100 text-ink-900"
                        : "border-ink-600 bg-transparent text-transparent",
                    ].join(" ")}
                  >
                    {activeLang === tr.language && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="flex-1">{tr.language}</span>
                  {tr.status === "processing" && (
                    <Loader2 className="h-3 w-3 animate-spin text-ink-500" />
                  )}
                  {tr.status === "failed" && (
                    <span className="text-[9px] uppercase tracking-wider text-red-400">
                      {t("card.translation.retry", { defaultValue: "retry" })}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void removeLanguage(tr.language)}
                  className="rounded p-0.5 text-ink-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300"
                  title={t("common.delete") ?? ""}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* Divider */}
            {addable.length > 0 && <div className="my-1 border-t border-ink-800" />}

            {/* Add a common language */}
            {addable.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => void startGenerate(lang)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-ink-300 transition hover:bg-ink-800/60 hover:text-ink-100"
              >
                <Plus className="h-3 w-3 text-ink-500" />
                <span className="flex-1 text-left">
                  {t("card.translation.translateTo", {
                    language: lang,
                    defaultValue: `Translate to ${lang}`,
                  })}
                </span>
              </button>
            ))}

            {/* Custom */}
            <button
              type="button"
              onClick={() => void promptCustomLanguage()}
              className="flex w-full items-center gap-2 border-t border-ink-800 px-3 py-1.5 text-[11px] text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
            >
              <Plus className="h-3 w-3 text-ink-500" />
              <span className="flex-1 text-left">
                {t("card.translation.customLanguage", {
                  defaultValue: "Other language…",
                })}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
