import { Check, ChevronDown, Languages, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/**
 * Per-card last-active-language persistence.
 *
 * Stored values:
 *   - missing key  → user has never made a picker choice for this card.
 *                    Falls through to `initialActiveLanguage` prop (the
 *                    global default-translation pref from Phase 3).
 *   - empty string → user explicitly picked "Original". Auto-activate
 *                    the global pref is suppressed for this card.
 *   - non-empty    → user last viewed this language. Auto-activate it
 *                    when a matching translation is ready.
 */
const CARD_LAST_LANGUAGE_PREFIX = "mindshift.cardLastLanguage.";

function readStoredCardLanguage(cardId: string): string | null | undefined {
  try {
    const raw = localStorage.getItem(CARD_LAST_LANGUAGE_PREFIX + cardId);
    if (raw === null) return undefined; // never picked
    return raw === "" ? null : raw; // null = Original, string = language
  } catch {
    return undefined;
  }
}

function writeStoredCardLanguage(cardId: string, lang: string | null) {
  try {
    localStorage.setItem(CARD_LAST_LANGUAGE_PREFIX + cardId, lang ?? "");
  } catch {
    /* private mode / quota — silently degrade to in-memory only */
  }
}

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
  // Resolve the effective initial language exactly once per cardId.
  // Per-card stored choice wins over the global pref; an explicit
  // "Original" choice ("ORIGINAL" sentinel) suppresses the global
  // pref so a user who already declined the auto-translate stays on
  // the source content.
  const [effectiveInitial] = useState<string | "ORIGINAL" | null>(() => {
    const stored = readStoredCardLanguage(cardId);
    if (stored === null) return "ORIGINAL";
    if (typeof stored === "string") return stored;
    return initialActiveLanguage ?? null;
  });
  const [activeLang, setActiveLang] = useState<string | null>(() => {
    // If the picker reopens for a card the user already viewed in a
    // specific language, set activeLang up-front so the trigger label
    // and onActive flow don't have to wait for a fetch + auto-activate
    // cycle. The translation might still be "processing" at this
    // point — onActive's gate (status === "ready") prevents premature
    // content swap.
    if (typeof effectiveInitial === "string" && effectiveInitial !== "ORIGINAL") {
      return effectiveInitial;
    }
    return null;
  });
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Portal-rendered menu position. Computed from the trigger's bounding
  // rect on open so the menu escapes any overflow-hidden ancestor
  // (= the Chrome side panel iframe, where the dropdown used to get
  // clipped). `placement` flips above when there's not enough room
  // below the trigger.
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "below" | "above";
  } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const compute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuWidth = 256;
      const estMenuHeight = 320; // matches max-h-72 + padding
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placement: "below" | "above" =
        spaceBelow < estMenuHeight && spaceAbove > spaceBelow ? "above" : "below";
      // Right-align with the trigger, but clamp to viewport so the menu
      // never extends past the left edge in narrow contexts (side panel,
      // mobile portrait).
      let left = rect.right - menuWidth;
      const minLeft = 8;
      const maxLeft = Math.max(minLeft, window.innerWidth - menuWidth - 8);
      if (left < minLeft) left = minLeft;
      if (left > maxLeft) left = maxLeft;
      const top = placement === "below" ? rect.bottom + 4 : rect.top - 4;
      setMenuPos({ top, left, width: menuWidth, placement });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);
  // Track whether we've consumed the initial-active-language hint yet.
  // Once the user clicks anything in the picker (or once we activate
  // the requested language), the hint stops applying. Without this
  // gate the user couldn't switch back to "Original" — the next poll
  // cycle would auto-flip them back.
  const initialHintConsumed = useRef(effectiveInitial === "ORIGINAL");

  /** Apply a user-driven language switch and persist it for this card. */
  const setActiveLangAndPersist = (next: string | null) => {
    initialHintConsumed.current = true;
    setActiveLang(next);
    writeStoredCardLanguage(cardId, next);
  };

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
    if (!effectiveInitial || effectiveInitial === "ORIGINAL") return;
    const tr = translations.find(
      (x) => x.language === effectiveInitial && x.status === "ready",
    );
    if (!tr) return;
    initialHintConsumed.current = true;
    setActiveLang(effectiveInitial);
  }, [translations, effectiveInitial]);

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
    typeof effectiveInitial === "string" &&
    effectiveInitial !== "ORIGINAL" &&
    !translations.some(
      (t2) => t2.language === effectiveInitial && t2.status === "ready",
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
          typeof effectiveInitial === "string" &&
          effectiveInitial !== "ORIGINAL" &&
          !rows.some(
            (r) => r.language === effectiveInitial && r.status === "ready",
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
  }, [shouldPoll, cardId, effectiveInitial]);

  // Close on outside click. With the menu rendered through a portal it
  // lives outside the wrapper subtree, so we also need to detect clicks
  // on the menu itself — track it via a separate ref attached to the
  // portal root below.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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
      setActiveLangAndPersist(language);
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
      if (activeLang === language) setActiveLangAndPersist(null);
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
        ref={triggerRef}
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

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="panel-elevated fixed z-50 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl"
          style={{
            top: menuPos.placement === "below" ? menuPos.top : undefined,
            // For "above" placement we use bottom-anchored positioning so
            // the menu grows upward from just above the trigger.
            bottom:
              menuPos.placement === "above"
                ? window.innerHeight - menuPos.top
                : undefined,
            left: menuPos.left,
            width: menuPos.width,
          }}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {/* Original */}
            <button
              type="button"
              onClick={() => {
                setActiveLangAndPersist(null);
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
                    setActiveLangAndPersist(tr.language);
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
        </div>,
        document.body,
      )}
    </div>
  );
}
