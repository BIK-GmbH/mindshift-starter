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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { api, type TagsTree as TagsTreeData, type TagWithCards } from "../lib/api";
import { playSound } from "../lib/sounds";

/**
 * Tags-picker modal.
 *   - Mobile (<sm): full-screen sheet (100% w/h) so the user has the
 *     whole viewport to scroll a long tag tree without fighting other
 *     UI chrome.
 *   - Desktop / tablet (sm+): centred card 480 × max-600 px on a blurred
 *     backdrop. Esc + backdrop-tap close.
 *
 * The picker itself is read-only navigation — pick a tag (or quick
 * action) and the parent closes the modal. Power management
 * (create / delete / reorder / share) lives on the desktop sidebar
 * because tap-to-pick + soft-keyboard fight react-arborist's drag layer.
 */

interface MobileTagNode {
  id: string;
  name: string;
  count: number;
  depth: number;
  hasChildren: boolean;
  children: MobileTagNode[];
  fullPath: string;
}

function buildTreeFromTags(tags: TagWithCards[]): MobileTagNode[] {
  const byId = new Map<string, MobileTagNode>();
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
  const annotate = (node: MobileTagNode, depth: number, parentPath: string) => {
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

function flattenVisible(roots: MobileTagNode[], expanded: Set<string>): MobileTagNode[] {
  const out: MobileTagNode[] = [];
  const walk = (nodes: MobileTagNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.hasChildren && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

function searchTree(roots: MobileTagNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const walk = (nodes: MobileTagNode[], ancestors: string[]) => {
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
  onClose: () => void;
}

export default function TagsPickerModal({ open, onClose }: Props) {
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Fetch the tree once per mount of the modal. The tree is small
  // (<1 KB serialised for a typical user); refetching on every open
  // is cheap and ensures freshly-created tags appear without a
  // page reload.
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

  // Esc to close, body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Autofocus the search input on open — desktop user expects to
  // type immediately, mobile user already has visual focus on the
  // big input, no harm.
  useEffect(() => {
    if (!open) return;
    // Defer one frame so the input is mounted.
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const roots = useMemo(() => (data ? buildTreeFromTags(data.tags) : []), [data]);
  const filterSet = useMemo(() => searchTree(roots, query), [roots, query]);
  const effectiveExpanded = useMemo(() => filterSet ?? expanded, [filterSet, expanded]);
  const visibleNodes = useMemo(
    () =>
      flattenVisible(roots, effectiveExpanded).filter(
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
    onClose();
  };

  const untaggedCount = data?.untagged.length ?? 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm"
      />

      {/* Sheet — fullscreen on mobile, centred card on sm+. */}
      <div
        className="
          relative z-10 m-auto flex w-full flex-col overflow-hidden bg-ink-900
          h-full sm:h-[min(640px,calc(100vh-48px))]
          sm:w-[480px] sm:max-w-[calc(100vw-48px)] sm:rounded-2xl sm:border sm:border-ink-700 sm:shadow-2xl
        "
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">
            {t("tags.modalTitle", { defaultValue: "Filter by tag" })}
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

        {/* Sticky search */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tags.search", { defaultValue: "Search tags…" }) ?? ""}
            inputMode="search"
            className="min-w-0 flex-1 bg-transparent text-ink-100 outline-none placeholder:text-ink-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("common.clear", { defaultValue: "Clear" }) ?? "Clear"}
              className="flex h-7 w-7 items-center justify-center rounded text-ink-400 active:bg-ink-800 hover:bg-ink-800 hover:text-ink-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Quick actions row — chips so they read as a single
            navigational bar, not three list rows. */}
        {!query && (
          <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-ink-800 px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <QuickChip
              icon={<Layers className="h-3.5 w-3.5" />}
              label={t("nav.allCards")}
              active={isAllActive}
              onClick={() => setActive({})}
            />
            {untaggedCount > 0 && (
              <QuickChip
                icon={<Inbox className="h-3.5 w-3.5" />}
                label={t("tags.untagged")}
                count={untaggedCount}
                active={isUntaggedActive}
                onClick={() => setActive({ untagged: true })}
              />
            )}
            <QuickChip
              icon={<PauseCircle className="h-3.5 w-3.5" />}
              label={t("library.readLaterFilter", { defaultValue: "Read Later" })}
              active={isPausedActive}
              onClick={() => setActive({ paused: true })}
            />
          </div>
        )}

        {/* Tag tree — flex-1 so it consumes the rest of the sheet
            height; overflow-y-auto keeps the search/quickchips bar
            sticky and lets the user scroll the long tag list. */}
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
                    "flex flex-1 items-center gap-2 px-3 text-left transition-colors min-h-[44px]",
                    isActive ? "text-ink-100" : "text-ink-200 active:bg-ink-800/60",
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
                    className="flex h-[44px] w-10 flex-shrink-0 items-center justify-center text-ink-400 active:bg-ink-800/60 hover:bg-ink-800/40 hover:text-ink-100"
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

        {/* Footer hint — visible on sm+ where the sidebar offers create
            functionality; on mobile the hint just adds noise so we
            keep the modal tight. */}
        <div className="hidden flex-shrink-0 border-t border-ink-800 px-4 py-2 text-[11px] text-ink-500 sm:block">
          {t("tags.modalFooterHint", {
            defaultValue: "Create, delete and reorder tags from the sidebar.",
          })}
        </div>
      </div>
    </div>
  );
}

interface QuickChipProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function QuickChip({ icon, label, count, active, onClick }: QuickChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors min-h-[36px]",
        active
          ? "bg-ink-100 text-ink-900"
          : "bg-ink-800/60 text-ink-200 ring-1 ring-ink-700 active:bg-ink-700",
      ].join(" ")}
    >
      <span className={active ? "text-ink-900" : "text-ink-400"}>{icon}</span>
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={[
            "tabular-nums",
            active ? "text-ink-700" : "text-ink-500",
          ].join(" ")}
          style={{ fontSize: "11px" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
