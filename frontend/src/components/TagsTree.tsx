import {
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Github,
  Globe,
  Hash,
  Inbox,
  Loader2,
  Plus,
  Search,
  Type,
  X,
  Youtube,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";

import { api, type TagCard, type TagsTree as TagsTreeData } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { on } from "../lib/events";
import { playHover } from "../lib/sounds";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  github: Github,
};

const EXPANDED_KEY = "mindshift.tagsExpanded";

/* ----------------------------------------------------------------------------
 * Tree data shape
 * --------------------------------------------------------------------------*/

type TreeItem = TagItem | CardItem | UntaggedFolderItem;

interface TagItem {
  /** Stable arborist id, distinct from the underlying tag.id so we can
   *  carry the same card UUID under multiple tags without id collisions. */
  id: string;
  kind: "tag";
  rawId: string;
  name: string;
  count: number;
  parentTagId: string | null;
  isPublic: boolean;
  /** "parent/child/leaf" slug path used to build the public URL. */
  slugPath: string;
  children: TreeItem[];
}

interface CardItem {
  id: string;
  kind: "card";
  rawId: string;
  name: string;
  thumbnailUrl: string | null;
  sourceType: string;
  parentTagId: string | null;
}

interface UntaggedFolderItem {
  id: "untagged-folder";
  kind: "untagged";
  rawId: "__untagged__";
  name: string;
  count: number;
  children: TreeItem[];
}

function buildTreeData(
  tagsData: TagsTreeData,
  untaggedLabel: string,
): TreeItem[] {
  const tagsById = new Map<string, TagItem>();
  // Build a TagItem for every tag, with cards attached as children.
  for (const t of tagsData.tags) {
    tagsById.set(t.id, {
      id: `tag:${t.id}`,
      kind: "tag",
      rawId: t.id,
      name: t.name,
      count: t.cards.length,
      parentTagId: t.parent_id,
      isPublic: t.is_public ?? false,
      slugPath: t.name, // resolved in second pass once parents are wired
      children: t.cards.map((c) => makeCardItem(c, t.id)),
    });
  }
  // Wire sub-tags into parents.
  const roots: TagItem[] = [];
  for (const t of tagsById.values()) {
    if (t.parentTagId && tagsById.has(t.parentTagId)) {
      tagsById.get(t.parentTagId)!.children.push(t);
    } else {
      roots.push(t);
    }
  }
  // Sort each level: sub-tags alphabetically, then cards alphabetically.
  const sortChildren = (item: TagItem) => {
    item.children.sort((a, b) => {
      const order = (i: TreeItem) => (i.kind === "tag" ? 0 : 1);
      const ord = order(a) - order(b);
      if (ord !== 0) return ord;
      return a.name.localeCompare(b.name);
    });
    for (const c of item.children) {
      if (c.kind === "tag") sortChildren(c);
    }
  };
  for (const r of roots) sortChildren(r);
  roots.sort((a, b) => a.name.localeCompare(b.name));

  // Resolve slug paths now that parents are wired.
  const resolveSlug = (t: TagItem): string => {
    if (!t.parentTagId) return t.name;
    const parent = tagsById.get(t.parentTagId);
    if (!parent) return t.name;
    return `${resolveSlug(parent)}/${t.name}`;
  };
  for (const t of tagsById.values()) {
    t.slugPath = resolveSlug(t);
  }

  const out: TreeItem[] = [...roots];
  if (tagsData.untagged.length > 0) {
    out.push({
      id: "untagged-folder",
      kind: "untagged",
      rawId: "__untagged__",
      name: untaggedLabel,
      count: tagsData.untagged.length,
      children: tagsData.untagged.map((c) => makeCardItem(c, null)),
    });
  }
  return out;
}

function makeCardItem(card: TagCard, parentTagId: string | null): CardItem {
  return {
    id: `card:${card.id}:${parentTagId ?? "untagged"}`,
    kind: "card",
    rawId: card.id,
    name: card.title,
    thumbnailUrl: card.thumbnail_url,
    sourceType: card.source_type,
    parentTagId,
  };
}

function filterTreeByQuery(items: TreeItem[], q: string): TreeItem[] {
  const out: TreeItem[] = [];
  for (const item of items) {
    if (item.kind !== "tag") {
      // Cards / untagged folder pass through unchanged.
      out.push(item);
      continue;
    }
    const selfMatches = item.name.toLowerCase().includes(q);
    const filteredChildren = filterTreeByQuery(item.children, q);
    const hasMatchingChild = filteredChildren.some((c) => c.kind === "tag");
    if (selfMatches) {
      // Show full subtree under a matching tag.
      out.push(item);
    } else if (hasMatchingChild) {
      // Keep ancestor visible so the matched child has a path; restrict
      // its visible children to the matched ones (+ their descendants).
      out.push({ ...item, children: filteredChildren });
    }
  }
  return out;
}

function descendantTagIds(item: TreeItem): Set<string> {
  const out = new Set<string>();
  if (item.kind !== "tag") return out;
  out.add(item.rawId);
  for (const c of item.children) {
    if (c.kind === "tag") {
      for (const d of descendantTagIds(c)) out.add(d);
    }
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------*/

export interface TagsTreeHandle {
  /** Re-fetch the tag tree from the server. Called by parents when an
   *  out-of-tree mutation (e.g. deleting a card) has happened that we
   *  can't observe locally. */
  refresh: () => void;
  /** Open the inline "create top-level tag" input and scroll the tree to the top. */
  createTag: () => void;
}

interface SharePopoverState {
  rawId: string;
  slugPath: string;
  isPublic: boolean;
  anchor: { left: number; top: number };
}

const TagsTree = forwardRef<TagsTreeHandle>(function TagsTree(_props, ref) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sharePopover, setSharePopover] = useState<SharePopoverState | null>(null);

  const publicUrlFor = (slugPath: string): string | null => {
    if (!user?.username) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/u/${user.username}/${slugPath}`;
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const activeTag = params.get("tag");
  const isUntaggedActive = params.get("untagged") === "1";
  const isAllActive = !activeTag && !isUntaggedActive;

  const [data, setData] = useState<TagsTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [creatingTopLevel, setCreatingTopLevel] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [size, setSize] = useState({ width: 230, height: 480 });
  const containerRef = useRef<HTMLDivElement>(null);
  const treeApiRef = useRef<TreeApi<TreeItem> | null>(null);
  const initialOpenStateRef = useRef<Record<string, boolean> | undefined>(undefined);

  // Read persisted expansion state once on mount, never updated reactively.
  if (initialOpenStateRef.current === undefined) {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      const map: Record<string, boolean> = {};
      for (const id of ids) map[id] = true;
      initialOpenStateRef.current = map;
    } catch {
      initialOpenStateRef.current = {};
    }
  }

  const refresh = async () => {
    try {
      const d = await api.tagsTree();
      setData(d);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [location.pathname]);

  // Refresh on data-mutation events from anywhere in the app — e.g.
  // CardDetailContent emits "card-deleted" after deleting, which
  // shifts the per-tag counts without changing the URL.
  useEffect(() => {
    const off1 = on("card-deleted", () => void refresh());
    const off2 = on("card-created", () => void refresh());
    return () => {
      off1();
      off2();
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const treeData = useMemo(() => {
    const full = data ? buildTreeData(data, t("tags.untagged") ?? "Untagged") : [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return full;
    return filterTreeByQuery(full, q);
  }, [data, t, searchQuery]);

  const openCard = (cardId: string) => {
    const next = new URLSearchParams(params);
    next.set("card", cardId);
    navigate(`/?${next.toString()}`);
  };

  const select = (tagName: string | null, untaggedSelect = false) => {
    const next = new URLSearchParams(params);
    if (tagName) {
      next.set("tag", tagName);
      next.delete("untagged");
    } else if (untaggedSelect) {
      next.set("untagged", "1");
      next.delete("tag");
    } else {
      next.delete("tag");
      next.delete("untagged");
    }
    navigate(`/${next.toString() ? `?${next.toString()}` : ""}`);
  };

  const startCreate = (parentRawId: string | null) => {
    if (parentRawId) {
      setCreatingUnder(parentRawId);
      setCreatingTopLevel(false);
      // Make sure the parent is open so the input is visible.
      const node = treeApiRef.current?.get(`tag:${parentRawId}`);
      node?.open();
    } else {
      setCreatingTopLevel(true);
      setCreatingUnder(null);
    }
    setNewName("");
    setError(null);
  };

  useImperativeHandle(
    ref,
    () => ({
      createTag: () => startCreate(null),
      refresh: () => void refresh(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const cancelCreate = () => {
    setCreatingUnder(null);
    setCreatingTopLevel(false);
    setNewName("");
    setError(null);
  };

  const submitCreate = async () => {
    const name = newName.trim().toLowerCase();
    if (!name) {
      cancelCreate();
      return;
    }
    const wasTopLevel = creatingTopLevel;
    setBusy(true);
    try {
      const created = await api.createTag(name, creatingUnder);
      await refresh();
      cancelCreate();
      if (wasTopLevel && created?.id) {
        // Tree just refreshed — wait one frame so the new node is mounted,
        // then scroll it into view at the top.
        requestAnimationFrame(() => {
          treeApiRef.current?.scrollTo(`tag:${created.id}`, "start");
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Validate drops:
   * - Cards cannot have children (no drop ON a card)
   * - Tags cannot drop into themselves or any descendant (cycle prevention)
   * - Cards cannot drop into their current parent tag (no-op)
   * - Nothing can drop INTO the synthetic "untagged" folder
   */
  const disableDrop = ({
    parentNode,
    dragNodes,
  }: {
    parentNode: NodeApi<TreeItem> | null;
    dragNodes: NodeApi<TreeItem>[];
  }) => {
    // Top-level (parentNode = null) — only tags may drop there
    if (!parentNode) {
      return dragNodes.some((n) => n.data.kind !== "tag");
    }
    const parentItem = parentNode.data;
    if (parentItem.kind === "card") return true;
    if (parentItem.kind === "untagged") return true;

    for (const dragNode of dragNodes) {
      const item = dragNode.data;
      if (item.kind === "tag") {
        const desc = descendantTagIds(item);
        if (desc.has(parentItem.rawId)) return true;
        if (item.parentTagId === parentItem.rawId) return true; // already under that parent
      } else if (item.kind === "card") {
        if (item.parentTagId === parentItem.rawId) return true;
      } else {
        return true;
      }
    }
    return false;
  };

  /**
   * Apply a move. arborist gives us the *new* parent + index.
   * We translate that into our REST calls.
   */
  const onMove = async ({
    dragNodes,
    parentNode,
  }: {
    dragNodes: NodeApi<TreeItem>[];
    parentNode: NodeApi<TreeItem> | null;
    index: number;
  }) => {
    const targetTagId =
      parentNode && parentNode.data.kind === "tag" ? parentNode.data.rawId : null;

    try {
      for (const node of dragNodes) {
        const item = node.data;
        if (item.kind === "tag") {
          await api.updateTag(item.rawId, { parent_id: targetTagId });
        } else if (item.kind === "card") {
          if (targetTagId == null) continue; // card cannot become root
          await api.assignTag(targetTagId, item.rawId);
          if (item.parentTagId && item.parentTagId !== targetTagId) {
            await api.unassignTag(item.parentTagId, item.rawId);
          }
        }
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const persistExpansion = () => {
    const tree = treeApiRef.current;
    if (!tree) return;
    const open: string[] = [];
    tree.visibleNodes.forEach((node) => {
      if (node.isOpen) open.push(node.id);
    });
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(open));
    } catch {
      /* ignore */
    }
  };

  const onToggle = (id: string) => {
    // Persist expansion state.
    setTimeout(persistExpansion, 0);
    void id;
  };

  const togglePublic = async (rawId: string, next: boolean) => {
    // Let callers (popover) handle the error UI locally — they have a
    // busy state and inline error chip we want to drive. We still keep
    // the outer error visible as a safety net.
    try {
      await api.updateTag(rawId, { is_public: next });
      setData((prev) =>
        prev
          ? {
              ...prev,
              tags: prev.tags.map((t2) =>
                t2.id === rawId ? { ...t2, is_public: next } : t2,
              ),
            }
          : prev,
      );
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const expandAll = () => {
    treeApiRef.current?.openAll();
    setTimeout(persistExpansion, 0);
  };

  const collapseAll = () => {
    treeApiRef.current?.closeAll();
    setTimeout(persistExpansion, 0);
  };

  return (
    <div className="flex h-full flex-col text-xs">
      {error && (
        <p className="mx-3 mb-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {error}
        </p>
      )}

      {/* Search + expand / collapse-all controls */}
      <div className="flex items-center gap-1 px-3 pb-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("tags.search", { defaultValue: "Search tags…" }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-800/40 py-1 pl-7 pr-7 text-[11px] text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-500 transition hover:bg-ink-700 hover:text-ink-100"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={expandAll}
          title={t("tags.expandAll", { defaultValue: "Expand all" }) ?? ""}
          aria-label="Expand all"
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-800/40 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <ChevronsUpDown className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title={t("tags.collapseAll", { defaultValue: "Collapse all" }) ?? ""}
          aria-label="Collapse all"
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-800/40 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <ChevronsDownUp className="h-3 w-3" />
        </button>
      </div>

      {/* Synthetic top-level entries that aren't part of the dnd-tree */}
      <div className="px-3">
        <button
          type="button"
          onClick={() => select(null)}
          className={[
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
            isAllActive
              ? "bg-ink-700/70 text-ink-100"
              : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
          ].join(" ")}
        >
          <Hash className="h-3 w-3 text-ink-500" />
          <span>{t("nav.allCards")}</span>
        </button>
        {creatingTopLevel && (
          <div className="mt-1">
            <CreateInput
              name={newName}
              onChange={setNewName}
              onSubmit={submitCreate}
              onCancel={cancelCreate}
              busy={busy}
            />
          </div>
        )}
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden px-1 pt-1">
        {loading ? (
          <div className="px-3 py-2 text-[10px] text-ink-500">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <Tree
            ref={treeApiRef}
            data={treeData}
            width={size.width}
            height={size.height}
            rowHeight={28}
            indent={14}
            overscanCount={10}
            paddingTop={2}
            paddingBottom={2}
            initialOpenState={initialOpenStateRef.current}
            disableDrop={disableDrop}
            onMove={onMove}
            onToggle={onToggle}
            onActivate={(node) => {
              const item = node.data;
              if (item.kind === "tag") select(item.name);
              else if (item.kind === "card") openCard(item.rawId);
              else if (item.kind === "untagged") select(null, true);
            }}
            // hide the line a11y border arborist draws by default
            renderCursor={(props) => <DropCursor {...props} />}
          >
            {(rendererProps) => (
              <TreeNode
                {...rendererProps}
                isUntaggedActive={isUntaggedActive}
                activeTag={activeTag}
                creatingUnderId={creatingUnder}
                creatingName={newName}
                setCreatingName={setNewName}
                submitCreate={submitCreate}
                cancelCreate={cancelCreate}
                busy={busy}
                onAddChild={(rawId) => startCreate(rawId)}
                onPickTag={(name) => select(name)}
                onPickCard={(id) => openCard(id)}
                onPickUntagged={() => select(null, true)}
                onTogglePublic={togglePublic}
                publicUrlFor={publicUrlFor}
                onShareClick={(rawId, slugPath, isPublic, anchor) =>
                  setSharePopover({ rawId, slugPath, isPublic, anchor })
                }
              />
            )}
          </Tree>
        )}
      </div>

      {sharePopover && (
        <TagSharePopover
          state={sharePopover}
          publicUrlFor={publicUrlFor}
          onClose={() => setSharePopover(null)}
          onTogglePublic={async (rawId, next) => {
            await togglePublic(rawId, next);
            // make-private: close immediately. make-public: keep the
            // popover open and switch it into URL-share mode so the
            // user can copy the link they just created.
            if (!next) {
              setSharePopover(null);
            } else {
              setSharePopover((prev) =>
                prev && prev.rawId === rawId ? { ...prev, isPublic: true } : prev,
              );
            }
          }}
        />
      )}
    </div>
  );
});

export default TagsTree;

function TagSharePopover({
  state,
  publicUrlFor,
  onClose,
  onTogglePublic,
}: {
  state: SharePopoverState;
  publicUrlFor: (slug: string) => string | null;
  onClose: () => void;
  onTogglePublic: (rawId: string, next: boolean) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp anchor.left into viewport so popover never spills off-screen.
  const POPOVER_W = 256;
  const left = Math.max(8, Math.min(state.anchor.left, window.innerWidth - POPOVER_W - 8));
  const top = Math.min(state.anchor.top, window.innerHeight - 120);
  const url = publicUrlFor(state.slugPath);

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: "fixed", left, top, width: POPOVER_W }}
      className="panel-elevated z-[80] rounded-md border border-ink-700 bg-ink-900 p-2 shadow-xl"
    >
      {!url ? (
        <p className="px-1 py-1 text-[10px] text-ink-400">
          {t("tags.share.needsProfile")}
        </p>
      ) : !state.isPublic ? (
        // Private tag — show only the explicit "Make public" affordance.
        // No URL preview: there's nothing to share until the user opts in.
        <div className="space-y-1.5">
          {error && (
            <p className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
              {error}
            </p>
          )}
          <p className="px-1 pt-1 text-[10px] leading-relaxed text-ink-400">
            {t("tags.share.publishHint")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onTogglePublic(state.rawId, true);
              } catch (err) {
                setError((err as Error).message ?? t("tags.share.failed"));
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
            {t("tags.share.makePublic")}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {error && (
            <p className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
              {error}
            </p>
          )}
          <div className="flex items-center gap-1">
            <input
              type="text"
              readOnly
              value={url}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 font-mono text-[10px] text-ink-200 focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* ignore */
                }
              }}
              title={t("tags.share.copy")}
              className={[
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border transition",
                copied
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-ink-700 text-ink-300 hover:bg-ink-800",
              ].join(" ")}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[10px] text-ink-200 transition hover:bg-ink-800"
            >
              <ExternalLink className="h-3 w-3" />
              {t("tags.share.open")}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onTogglePublic(state.rawId, false);
                } catch (err) {
                  setError((err as Error).message ?? t("tags.share.failed"));
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[10px] text-ink-300 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
              {t("tags.share.makePrivate")}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------------------------
 * Node renderer
 * --------------------------------------------------------------------------*/

interface NodeExtras {
  isUntaggedActive: boolean;
  activeTag: string | null;
  creatingUnderId: string | null;
  creatingName: string;
  setCreatingName: (v: string) => void;
  submitCreate: () => void;
  cancelCreate: () => void;
  busy: boolean;
  onAddChild: (rawId: string) => void;
  onPickTag: (name: string) => void;
  onPickCard: (rawId: string) => void;
  onPickUntagged: () => void;
  onTogglePublic: (rawId: string, next: boolean) => void;
  publicUrlFor: (slugPath: string) => string | null;
  onShareClick: (
    rawId: string,
    slugPath: string,
    isPublic: boolean,
    anchor: { left: number; top: number },
  ) => void;
}

function TreeNode({
  node,
  style,
  dragHandle,
  isUntaggedActive,
  activeTag,
  creatingUnderId,
  creatingName,
  setCreatingName,
  submitCreate,
  cancelCreate,
  busy,
  onAddChild,
  onPickTag,
  onPickCard,
  onPickUntagged,
  onTogglePublic: _onTogglePublic, // popover handles toggle now; click on globe just opens the popover
  publicUrlFor: _publicUrlFor, // unused now — popover lives in parent
  onShareClick,
}: NodeRendererProps<TreeItem> & NodeExtras) {
  const { t } = useTranslation();
  const item = node.data;
  const isInternal = node.isInternal;
  const isOpen = node.isOpen;
  const willReceiveDrop = node.willReceiveDrop;

  if (item.kind === "card") {
    const Icon = SOURCE_ICONS[item.sourceType] ?? Type;
    return (
      <div ref={dragHandle} style={style} className="px-1">
        <div
          onClick={() => onPickCard(item.rawId)}
          onMouseEnter={playHover}
          className={[
            "group flex h-full select-none cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100",
            node.isDragging ? "opacity-30" : "",
          ].join(" ")}
        >
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              className="ml-3 h-3.5 w-5 flex-shrink-0 rounded-sm object-cover"
            />
          ) : (
            <div className="ml-3 flex h-3.5 w-5 flex-shrink-0 items-center justify-center rounded-sm bg-ink-800">
              <Icon className="h-2.5 w-2.5 text-ink-500" />
            </div>
          )}
          <span className="truncate text-[11px]">{item.name}</span>
        </div>
      </div>
    );
  }

  if (item.kind === "untagged") {
    const isActive = isUntaggedActive;
    return (
      <div ref={dragHandle} style={style} className="px-1">
        <div
          onClick={() => {
            if (isInternal) node.toggle();
            onPickUntagged();
          }}
          className={[
            "group relative flex h-full select-none cursor-pointer items-center gap-1 rounded-md pr-1 transition",
            isActive
              ? "bg-ink-700/70 text-ink-100"
              : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-ink-500 hover:text-ink-100"
            aria-label="toggle"
          >
            <ChevronRight
              className={[
                "h-3 w-3 transition-transform",
                isOpen ? "rotate-90" : "rotate-0",
              ].join(" ")}
            />
          </button>
          <Inbox className="h-3 w-3 flex-shrink-0 text-ink-400" />
          <span className="flex-1 truncate italic text-ink-400">{item.name}</span>
          <span className="rounded-full px-1.5 text-[9px] font-medium tabular-nums text-ink-500">
            {item.count}
          </span>
        </div>
      </div>
    );
  }

  // Tag
  const isActive = activeTag === item.name;
  const isExpandable = item.children.length > 0;
  const isCreatingHere = creatingUnderId === item.rawId;

  return (
    <div ref={dragHandle} style={style} className="px-1">
      <div
        onClick={() => onPickTag(item.name)}
        className={[
          "group relative flex h-full select-none cursor-grab items-center gap-1 rounded-md pr-1 transition active:cursor-grabbing",
          isActive
            ? "bg-ink-700/70 text-ink-100"
            : willReceiveDrop
            ? "bg-emerald-500/20 text-ink-100 ring-1 ring-emerald-500/50"
            : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
          node.isDragging ? "opacity-30" : "",
        ].join(" ")}
      >
        {isExpandable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-ink-500 hover:text-ink-100"
            aria-label="toggle"
          >
            <ChevronRight
              className={[
                "h-3 w-3 transition-transform",
                isOpen ? "rotate-90" : "rotate-0",
              ].join(" ")}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}

        <Hash className="h-3 w-3 flex-shrink-0 text-ink-500" />
        <span className="flex-1 truncate">{item.name}</span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Open the popover only — never auto-publish. The popover
            // carries an explicit "Make public" button for that step,
            // so a stray click on the globe icon is harmless.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onShareClick(item.rawId, item.slugPath, item.isPublic, {
              // Open the popover to the right of the globe (its left
              // edge sits at the button's left edge). The library pane
              // gives plenty of horizontal room; the viewport-clamp
              // below handles narrow windows.
              left: rect.left,
              top: rect.bottom + 4,
            });
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={[
            "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition",
            item.isPublic
              ? "text-emerald-400 opacity-100 hover:bg-emerald-500/10"
              : "text-ink-500 opacity-0 hover:bg-ink-700 hover:text-ink-100 group-hover:opacity-100",
          ].join(" ")}
          title={
            item.isPublic
              ? t("tags.share.tooltipPublic")
              : t("tags.share.tooltipPrivate")
          }
        >
          <Globe className="h-3 w-3" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild(item.rawId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-ink-500 opacity-0 transition hover:bg-ink-700 hover:text-ink-100 group-hover:opacity-100"
          title="Add sub-tag"
        >
          <Plus className="h-3 w-3" />
        </button>

        <span
          className={[
            "ml-1 rounded-full px-1.5 text-[9px] font-medium tabular-nums",
            isActive ? "bg-ink-100/15 text-ink-100" : "text-ink-500",
          ].join(" ")}
        >
          {item.count}
        </span>
      </div>

      {isCreatingHere && isOpen && (
        <div className="mt-0.5 pl-6">
          <CreateInput
            name={creatingName}
            onChange={setCreatingName}
            onSubmit={submitCreate}
            onCancel={cancelCreate}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Drop cursor — the line arborist shows between rows during drag
 * --------------------------------------------------------------------------*/

function DropCursor({
  top,
  left,
  indent,
}: {
  top: number;
  left: number;
  indent: number;
}) {
  return (
    <div
      className="pointer-events-none absolute h-0.5 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
      style={{ top: top - 1, left: left + indent + 4, right: 8 }}
    />
  );
}

function CreateInput({
  name,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  name: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t("tags.newTagPlaceholder") ?? ""}
        disabled={busy}
        className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-[11px] text-ink-100 placeholder:text-ink-500 focus:border-ink-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="rounded p-0.5 text-ink-300 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-50"
        aria-label="save"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded p-0.5 text-ink-500 hover:bg-ink-700 hover:text-ink-100"
        aria-label="cancel"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
