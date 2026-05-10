import { Check, ChevronRight, Hash, Loader2, Plus, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type TagsTree as TagsTreeData, type TagWithCards } from "../lib/api";
import { playSound } from "../lib/sounds";

/**
 * Tag-assign modal for a single card — fullscreen on mobile, centred
 * 480 px panel on sm+. Distinct from TagsPickerModal (which sets the
 * library filter); this one toggles assignTag / unassignTag on the
 * supplied card. Reached primarily from the mobile swipe-right gesture.
 */

interface TagNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  children: TagNode[];
  fullPath: string;
}

function buildTree(tags: TagWithCards[]): TagNode[] {
  const byId = new Map<string, TagNode>();
  for (const t of tags) {
    byId.set(t.id, {
      id: t.id,
      name: t.name,
      parentId: t.parent_id,
      depth: 0,
      hasChildren: false,
      children: [],
      fullPath: t.name,
    });
  }
  const roots: TagNode[] = [];
  for (const t of tags) {
    const node = byId.get(t.id);
    if (!node) continue;
    if (t.parent_id && byId.has(t.parent_id)) {
      const parent = byId.get(t.parent_id);
      if (parent) {
        parent.children.push(node);
        parent.hasChildren = true;
      }
    } else {
      roots.push(node);
    }
  }
  const annotate = (node: TagNode, depth: number, parentPath: string) => {
    node.depth = depth;
    node.fullPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    node.children.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    for (const child of node.children) annotate(child, depth + 1, node.fullPath);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const r of roots) annotate(r, 0, "");
  return roots;
}

function flatten(roots: TagNode[], expanded: Set<string>): TagNode[] {
  const out: TagNode[] = [];
  const walk = (nodes: TagNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.hasChildren && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

function searchTree(roots: TagNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const walk = (nodes: TagNode[], ancestors: string[]) => {
    for (const n of nodes) {
      const lineage = [...ancestors, n.id];
      if (n.fullPath.toLowerCase().includes(q)) {
        for (const a of lineage) keep.add(a);
      }
      walk(n.children, lineage);
    }
  };
  walk(roots, []);
  return keep;
}

interface Props {
  open: boolean;
  cardId: string | null;
  /** Tag names already attached when the modal opens. */
  initialTags: string[];
  onClose: () => void;
  /** Fires after every assign/unassign so the parent list can refresh
   *  its in-memory card.tags without a full refetch. */
  onTagsChanged?: (cardId: string, tags: string[]) => void;
}

export default function CardAssignTagsModal({
  open,
  cardId,
  initialTags,
  onClose,
  onTagsChanged,
}: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<TagsTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [attached, setAttached] = useState<Set<string>>(new Set(initialTags));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the modal opens for a (possibly different) card.
  useEffect(() => {
    if (!open) return;
    setAttached(new Set(initialTags));
    setQuery("");
    setExpanded(new Set());
  }, [open, initialTags]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const d = await api.tagsTree();
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const roots = useMemo(() => (data ? buildTree(data.tags) : []), [data]);
  const filterSet = useMemo(() => searchTree(roots, query), [roots, query]);
  const effectiveExpanded = useMemo(() => filterSet ?? expanded, [filterSet, expanded]);
  const visibleNodes = useMemo(
    () =>
      flatten(roots, effectiveExpanded).filter(
        (n) => !filterSet || filterSet.has(n.id),
      ),
    [roots, effectiveExpanded, filterSet],
  );

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAssignment = async (node: TagNode) => {
    if (!cardId || busy) return;
    setBusy(true);
    const wasAttached = attached.has(node.name);
    // Optimistic toggle so the checkmark animates immediately.
    setAttached((prev) => {
      const next = new Set(prev);
      if (wasAttached) next.delete(node.name);
      else next.add(node.name);
      return next;
    });
    try {
      if (wasAttached) {
        await api.unassignTag(node.id, cardId);
      } else {
        await api.assignTag(node.id, cardId);
        playSound("tick");
      }
      onTagsChanged?.(
        cardId,
        Array.from(
          (() => {
            const s = new Set(attached);
            if (wasAttached) s.delete(node.name);
            else s.add(node.name);
            return s;
          })(),
        ).sort((a, b) => a.localeCompare(b)),
      );
    } catch (err) {
      // Roll back optimistic toggle on failure.
      setAttached((prev) => {
        const next = new Set(prev);
        if (wasAttached) next.add(node.name);
        else next.delete(node.name);
        return next;
      });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    const name = query.trim();
    if (!name || !cardId || busy) return;
    setBusy(true);
    try {
      const created = await api.createTag(name);
      await api.assignTag(created.id, cardId);
      // Refresh the tree so the new tag shows up with the right depth.
      const refreshed = await api.tagsTree();
      setData(refreshed);
      setAttached((prev) => {
        const next = new Set(prev);
        next.add(created.name);
        return next;
      });
      onTagsChanged?.(
        cardId,
        Array.from(new Set([...attached, created.name])).sort((a, b) => a.localeCompare(b)),
      );
      playSound("tick");
      setQuery("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (data?.tags ?? []).some((tg) => tg.name.toLowerCase() === q);
  }, [query, data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm"
      />
      <div
        className="
          relative z-10 m-auto flex w-full flex-col overflow-hidden bg-ink-900
          h-full sm:h-[min(640px,calc(100vh-48px))]
          sm:w-[480px] sm:max-w-[calc(100vw-48px)] sm:rounded-2xl sm:border sm:border-ink-700 sm:shadow-2xl
        "
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">
            {t("card.tagsBar.assignTitle", { defaultValue: "Tags zuweisen" })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-300 transition active:bg-ink-800 hover:bg-ink-800 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !exactMatch) {
                e.preventDefault();
                void createAndAssign();
              }
            }}
            placeholder={
              t("card.tagsBar.searchOrCreate", {
                defaultValue: "Suchen oder neu anlegen…",
              }) ?? ""
            }
            inputMode="search"
            className="min-w-0 flex-1 bg-transparent text-ink-100 outline-none placeholder:text-ink-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("common.clear", { defaultValue: "Clear" }) ?? "Clear"}
              className="flex h-7 w-7 items-center justify-center rounded text-ink-400 active:bg-ink-800 hover:bg-ink-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading", { defaultValue: "Loading…" })}
            </div>
          )}
          {error && (
            <p className="mx-3 mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
              {error}
            </p>
          )}
          {!loading && !error && roots.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-ink-500">
              {t("tags.empty", { defaultValue: "No tags yet." })}
            </p>
          )}
          {visibleNodes.map((node) => {
            const isAttached = attached.has(node.name);
            const isOpen = effectiveExpanded.has(node.id);
            return (
              <div
                key={node.id}
                className="relative flex items-stretch"
                style={{ paddingLeft: `${node.depth * 14}px` }}
              >
                <button
                  type="button"
                  onClick={() => void toggleAssignment(node)}
                  disabled={busy}
                  className={[
                    "flex flex-1 items-center gap-3 px-3 text-left transition-colors min-h-[44px]",
                    isAttached ? "text-ink-100" : "text-ink-200 active:bg-ink-800/60",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition",
                      isAttached
                        ? "border-ink-100 bg-ink-100 text-ink-900"
                        : "border-ink-600 bg-transparent",
                    ].join(" ")}
                  >
                    {isAttached && <Check className="h-3 w-3" />}
                  </span>
                  <Hash
                    className={[
                      "h-3.5 w-3.5 flex-shrink-0",
                      isAttached ? "text-ink-100" : "text-ink-500",
                    ].join(" ")}
                  />
                  <span className="flex-1 truncate">{node.name}</span>
                </button>
                {node.hasChildren && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(node.id)}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    className="flex h-[44px] w-10 flex-shrink-0 items-center justify-center text-ink-400 active:bg-ink-800/60"
                  >
                    <ChevronRight
                      className={[
                        "h-4 w-4 transition-transform",
                        isOpen ? "rotate-90" : "",
                      ].join(" ")}
                    />
                  </button>
                )}
              </div>
            );
          })}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => void createAndAssign()}
              disabled={busy}
              className="mt-1 flex w-full items-center gap-2 border-t border-ink-800 px-4 py-3 text-[13px] text-emerald-300 transition active:bg-emerald-500/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                {t("card.tagsBar.create", {
                  name: query.trim(),
                  defaultValue: 'Create "{{name}}" + assign',
                })}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
