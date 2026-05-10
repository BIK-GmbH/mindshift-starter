import {
  ChevronRight,
  Hash,
  Inbox,
  Layers,
  Loader2,
  PauseCircle,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { api, type TagsTree as TagsTreeData, type TagWithCards } from "../lib/api";
import { playSound } from "../lib/sounds";

/**
 * Mobile-optimised tag picker — read-only accordion tree.
 *
 * Why a separate component instead of reusing TagsTree:
 *   - react-arborist demands explicit width/height; mobile layout is
 *     fluid (drawer width = 256 px, but height responds to keyboard).
 *   - Tap targets need 44 px minimum (Apple HIG); arborist's row
 *     padding tops out around 24 px.
 *   - Drag-to-reparent fights iOS native scroll. Power management
 *     (create / delete / share / move) is best left to desktop.
 *   - Card children inside the tree blow up the row count on a
 *     vertical phone screen — we drop them entirely; tap a tag to
 *     drill into its card list.
 *
 * Behaviour:
 *   - Tap row label → activate as filter, close drawer.
 *   - Tap chevron → toggle expand/collapse (parent rows only).
 *   - Local search filters by tag name (path).
 *   - Three quick actions pinned at top: All cards, Untagged,
 *     Read Later (paused).
 *   - Active tag gets a 2 px left accent bar.
 */

interface MobileTagNode {
  id: string;
  name: string;
  count: number;
  depth: number;
  hasChildren: boolean;
  children: MobileTagNode[];
  /** Concatenated parent names for fuzzy search ("ai/agents/coding"). */
  fullPath: string;
}

function buildTreeFromTags(tags: TagWithCards[]): MobileTagNode[] {
  const byId = new Map<string, MobileTagNode>();
  // First pass: every tag gets a node with empty children.
  for (const t of tags) {
    byId.set(t.id, {
      id: t.id,
      name: t.name,
      count: t.count,
      depth: 0,
      hasChildren: false,
      children: [],
      fullPath: t.name,
    });
  }
  // Second pass: link children to parents.
  const roots: MobileTagNode[] = [];
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
  // Third pass: depth + fullPath. Recursive but bounded by tag count
  // (max ~200 in practice).
  const annotate = (node: MobileTagNode, depth: number, parentPath: string) => {
    node.depth = depth;
    node.fullPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const child of node.children) annotate(child, depth + 1, node.fullPath);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const r of roots) annotate(r, 0, "");
  return roots;
}

/** Walk the tree in-order, yielding only nodes whose `id` is in the
 *  expanded set OR whose entire ancestry is. Returns a flat list of
 *  visible nodes for the renderer. */
function flattenVisible(roots: MobileTagNode[], expanded: Set<string>): MobileTagNode[] {
  const out: MobileTagNode[] = [];
  const walk = (nodes: MobileTagNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.hasChildren && expanded.has(n.id)) {
        walk(n.children);
      }
    }
  };
  walk(roots);
  return out;
}

/** Search over the *flattened-by-fullPath* representation. Returns a
 *  set of node ids to keep visible (matches + their ancestors). */
function searchTree(roots: MobileTagNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const walk = (nodes: MobileTagNode[], ancestors: string[]) => {
    for (const n of nodes) {
      const lineage = [...ancestors, n.id];
      const hit = n.fullPath.toLowerCase().includes(q);
      if (hit) for (const a of lineage) keep.add(a);
      walk(n.children, lineage);
    }
  };
  walk(roots, []);
  return keep;
}

interface Props {
  /** Called when the user picks a quick action / tag — the parent
   *  closes the drawer. */
  onPick: () => void;
}

export default function TagsPickerMobile({ onPick }: Props) {
  const { t } = useTranslation();
  const [, setParams] = useSearchParams();
  const [params] = useSearchParams();
  const activeTag = params.get("tag");
  const isUntaggedActive = params.get("untagged") === "1";
  const isPausedActive = params.get("status") === "paused";
  const isAllActive = !activeTag && !isUntaggedActive && !isPausedActive;

  const [data, setData] = useState<TagsTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const roots = useMemo(() => (data ? buildTreeFromTags(data.tags) : []), [data]);
  const filterSet = useMemo(() => searchTree(roots, query), [roots, query]);

  // When searching, every matched-or-ancestor node is auto-expanded
  // so the user sees the deep matches without manual taps.
  const effectiveExpanded = useMemo(() => {
    if (filterSet) return filterSet; // every visible ancestor expanded
    return expanded;
  }, [filterSet, expanded]);

  const visibleNodes = useMemo(
    () => flattenVisible(roots, effectiveExpanded).filter((n) => !filterSet || filterSet.has(n.id)),
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

  const setActive = (next: { tag?: string; untagged?: boolean; paused?: boolean }) => {
    const sp = new URLSearchParams(params);
    sp.delete("tag");
    sp.delete("untagged");
    sp.delete("status");
    if (next.tag) sp.set("tag", next.tag);
    if (next.untagged) sp.set("untagged", "1");
    if (next.paused) sp.set("status", "paused");
    setParams(sp, { replace: false });
    playSound("tick");
    onPick();
  };

  const untaggedCount = data?.untagged.length ?? 0;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Search */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2">
        <SearchIcon className="h-4 w-4 flex-shrink-0 text-ink-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("tags.search", { defaultValue: "Search tags…" }) ?? ""}
          className="min-w-0 flex-1 bg-transparent text-ink-100 outline-none placeholder:text-ink-500"
          // 16 px font-size override is global (index.html) — no zoom.
          inputMode="search"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear"
            className="flex h-7 w-7 items-center justify-center rounded text-ink-400 active:bg-ink-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex-shrink-0 border-b border-ink-800 py-1">
        <QuickAction
          icon={<Layers className="h-4 w-4" />}
          label={t("nav.allCards")}
          active={isAllActive}
          onClick={() => setActive({})}
        />
        {untaggedCount > 0 && (
          <QuickAction
            icon={<Inbox className="h-4 w-4" />}
            label={t("tags.untagged")}
            count={untaggedCount}
            active={isUntaggedActive}
            onClick={() => setActive({ untagged: true })}
          />
        )}
        <QuickAction
          icon={<PauseCircle className="h-4 w-4" />}
          label={t("library.readLaterFilter", { defaultValue: "Read Later" })}
          active={isPausedActive}
          onClick={() => setActive({ paused: true })}
        />
      </div>

      {/* Tag tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-ink-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("common.loading", { defaultValue: "Loading…" })}
          </div>
        )}
        {error && (
          <p className="mx-3 mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
            {error}
          </p>
        )}
        {!loading && !error && roots.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-ink-500">
            {t("tags.empty", {
              defaultValue: "No tags yet. Create your first one above.",
            })}
          </p>
        )}
        {!loading && !error && roots.length > 0 && visibleNodes.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-ink-500">
            {t("tags.noMatch", { defaultValue: "No tags match your search." })}
          </p>
        )}
        {visibleNodes.map((node) => {
          const isActive = activeTag === node.name;
          const isOpen = effectiveExpanded.has(node.id);
          return (
            <div
              key={node.id}
              className="relative flex items-stretch"
              style={{ paddingLeft: `${node.depth * 14}px` }}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-ink-100" />
              )}
              <button
                type="button"
                onClick={() => setActive({ tag: node.name })}
                className={[
                  "flex flex-1 items-center gap-2 px-3 text-left transition-colors",
                  // 44 px row — taps comfortably with thumb.
                  "min-h-[44px]",
                  isActive
                    ? "text-ink-100"
                    : "text-ink-200 active:bg-ink-800/60",
                ].join(" ")}
              >
                <Hash
                  className={[
                    "h-3.5 w-3.5 flex-shrink-0",
                    isActive ? "text-ink-100" : "text-ink-500",
                  ].join(" ")}
                />
                <span className="flex-1 truncate">{node.name}</span>
                <span
                  className={[
                    "flex-shrink-0 tabular-nums",
                    isActive ? "text-ink-300" : "text-ink-500",
                  ].join(" ")}
                  style={{ fontSize: "11px" }}
                >
                  {node.count}
                </span>
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
      </div>

      {/* Footer hint — link out to the desktop tag manager */}
      <div className="flex-shrink-0 border-t border-ink-800 px-3 py-2 text-[10px] text-ink-500">
        {t("tags.mobileFooterHint", {
          defaultValue: "Create, delete and reorder tags from the desktop app.",
        })}
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function QuickAction({ icon, label, count, active, onClick }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative flex w-full items-center gap-2 px-3 text-left transition-colors",
        "min-h-[44px]",
        active ? "text-ink-100" : "text-ink-200 active:bg-ink-800/60",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-ink-100" />
      )}
      <span className={active ? "text-ink-100" : "text-ink-400"}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className={["flex-shrink-0 tabular-nums", active ? "text-ink-300" : "text-ink-500"].join(" ")}
          style={{ fontSize: "11px" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
