import { Check, Hash, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type TagWithCount } from "../lib/api";

interface Props {
  cardId: string;
  /** Tag names currently attached to the card. */
  initialTags: string[];
  /** Notify parent so it can keep the Card object in sync without a refetch. */
  onTagsChanged?: (tags: string[]) => void;
}

/**
 * Inline tag pills + tag picker for the card-detail header. Click ×
 * on a pill to unassign; click + to open a popover with the user's
 * tags (search + checkboxes); type a brand-new name to create-and-assign.
 */
export default function CardTagsBar({ cardId, initialTags, onTagsChanged }: Props) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [allTags, setAllTags] = useState<TagWithCount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep local state in sync if parent re-fetches.
  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  // Lazy-load all user tags the first time the picker opens.
  useEffect(() => {
    if (!open || allTags !== null) return;
    void api.listTags().then(setAllTags);
  }, [open, allTags]);

  // Outside click closes the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const attachedSet = useMemo(() => new Set(tags), [tags]);
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = (allTags ?? []).filter((tag) =>
    trimmedQuery.length === 0 ? true : tag.name.toLowerCase().includes(trimmedQuery),
  );
  const exactMatch = (allTags ?? []).some((t2) => t2.name.toLowerCase() === trimmedQuery);
  const canCreate = trimmedQuery.length > 0 && !exactMatch;

  const toggleTag = async (name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const list = allTags ?? (await api.listTags());
      const tag = list.find((t2) => t2.name === name);
      if (!tag) {
        setBusy(false);
        return;
      }
      let next: string[];
      if (attachedSet.has(name)) {
        await api.unassignTag(tag.id, cardId);
        next = tags.filter((x) => x !== name);
      } else {
        await api.assignTag(tag.id, cardId);
        next = [...tags, name].sort((a, b) => a.localeCompare(b));
      }
      setTags(next);
      onTagsChanged?.(next);
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    const name = trimmedQuery;
    if (!name || busy) return;
    setBusy(true);
    try {
      const created = await api.createTag(name);
      // Reload the cached tag list so the new tag shows up + has counts.
      const refreshed = await api.listTags();
      setAllTags(refreshed);
      await api.assignTag(created.id, cardId);
      const next = [...tags, created.name].sort((a, b) => a.localeCompare(b));
      setTags(next);
      onTagsChanged?.(next);
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  const removeTag = async (name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const list = allTags ?? (await api.listTags());
      const tag = list.find((t2) => t2.name === name);
      if (tag) {
        await api.unassignTag(tag.id, cardId);
      }
      const next = tags.filter((x) => x !== name);
      setTags(next);
      onTagsChanged?.(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative flex min-h-[2.75rem] flex-wrap content-start items-start gap-1.5"
    >
      {tags.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-full bg-ink-700/70 px-2.5 py-0.5 text-[11px] font-medium text-ink-100 ring-1 ring-ink-600"
        >
          <Hash className="h-2.5 w-2.5 text-ink-300" />
          {name}
          <button
            type="button"
            onClick={() => void removeTag(name)}
            disabled={busy}
            className="ml-0.5 rounded p-0.5 text-ink-400 transition hover:bg-ink-600 hover:text-ink-100 disabled:opacity-50"
            title={t("card.tagsBar.unassign", { defaultValue: "Remove tag" }) ?? ""}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-700 px-2 py-0.5 text-[11px] text-ink-400 transition hover:border-ink-500 hover:bg-ink-800/40 hover:text-ink-100"
      >
        <Plus className="h-2.5 w-2.5" />
        {t("card.tagsBar.add", { defaultValue: "Tag" })}
      </button>

      {open && (
        <div className="panel-elevated absolute left-0 top-[calc(100%+4px)] z-30 w-72 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl">
          <div className="border-b border-ink-800 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    e.preventDefault();
                    void createAndAssign();
                  }
                }}
                placeholder={t("card.tagsBar.search", { defaultValue: "Search or create…" }) ?? ""}
                className="w-full rounded-md border border-ink-700 bg-ink-800/60 py-1 pl-7 pr-2 text-[11px] focus:border-ink-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {allTags === null ? (
              <p className="px-3 py-2 text-[10px] text-ink-500">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {t("common.loading")}
              </p>
            ) : filtered.length === 0 && !canCreate ? (
              <p className="px-3 py-2 text-[10px] text-ink-500">
                {t("card.tagsBar.noTags", { defaultValue: "No tags match." })}
              </p>
            ) : (
              filtered.map((tag) => {
                const attached = attachedSet.has(tag.name);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => void toggleTag(tag.name)}
                    disabled={busy}
                    className={[
                      "flex w-full items-center gap-2 px-2.5 py-1 text-[11px] transition",
                      attached
                        ? "bg-ink-800/80 text-ink-100"
                        : "text-ink-200 hover:bg-ink-800/60",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border",
                        attached
                          ? "border-ink-100 bg-ink-100 text-ink-900"
                          : "border-ink-600 bg-transparent text-transparent",
                      ].join(" ")}
                    >
                      {attached && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <Hash className="h-3 w-3 text-ink-400" />
                    <span className="flex-1 truncate">{tag.name}</span>
                    <span className="text-[10px] tabular-nums text-ink-500">{tag.count}</span>
                  </button>
                );
              })
            )}
            {canCreate && (
              <button
                type="button"
                onClick={() => void createAndAssign()}
                disabled={busy}
                className="flex w-full items-center gap-2 border-t border-ink-800 px-2.5 py-1.5 text-[11px] text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                <span>
                  {t("card.tagsBar.create", {
                    name: trimmedQuery,
                    defaultValue: 'Create "{{name}}" + assign',
                  })}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
