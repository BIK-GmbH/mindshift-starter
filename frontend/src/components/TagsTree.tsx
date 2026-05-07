import {
  ChevronRight,
  FileText,
  Globe,
  Hash,
  Inbox,
  Loader2,
  Plus,
  Type,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";

import { api, type TagCard, type TagsTree as TagsTreeData } from "../lib/api";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
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

export default function TagsTree() {
  const { t } = useTranslation();
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const treeData = useMemo(
    () => (data ? buildTreeData(data, t("tags.untagged") ?? "Untagged") : []),
    [data, t],
  );

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
    setBusy(true);
    try {
      await api.createTag(name, creatingUnder);
      await refresh();
      cancelCreate();
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

  const onToggle = (id: string) => {
    // Persist expansion state.
    setTimeout(() => {
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
    }, 0);
    void id;
  };

  return (
    <div className="flex h-full flex-col text-xs">
      {error && (
        <p className="mx-3 mb-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {error}
        </p>
      )}

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
              else if (item.kind === "card") navigate(`/cards/${item.rawId}`);
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
                onPickCard={(id) => navigate(`/cards/${id}`)}
                onPickUntagged={() => select(null, true)}
              />
            )}
          </Tree>
        )}
      </div>

      <div className="border-t border-ink-800 px-3 py-2">
        <button
          type="button"
          onClick={() => startCreate(null)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <Plus className="h-3 w-3" />
          {t("tags.newTag")}
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
    </div>
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
}: NodeRendererProps<TreeItem> & NodeExtras) {
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
