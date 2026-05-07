import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  FileText,
  Globe,
  Hash,
  Inbox,
  Loader2,
  Plus,
  Type,
  Youtube,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, type TagCard, type TagsTree as TagsTreeData, type TagWithCards } from "../lib/api";

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
};

interface TreeNode {
  tag: TagWithCards;
  children: TreeNode[];
  /** Sum of own count + all descendants' card counts. */
  totalCount: number;
}

const EXPANDED_KEY = "mindshift.tagsExpanded";

type DragKind = "tag" | "card";
interface DragData {
  kind: DragKind;
  id: string; // tag.id or card.id
  parentTagId?: string | null; // for cards: which tag they came from (null if untagged)
}

export default function TagsTree() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const activeTag = params.get("tag");

  const [data, setData] = useState<TagsTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    return new Set();
  });
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [creatingTopLevel, setCreatingTopLevel] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const expandTimerRef = useRef<{ id: string; timer: number } | null>(null);

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
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const tree = useMemo(() => buildTree(data?.tags ?? []), [data]);

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

  const toggle = (tagId: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const startCreate = (parentId: string | null) => {
    if (parentId) {
      setCreatingUnder(parentId);
      setCreatingTopLevel(false);
      setExpanded((s) => new Set([...s, parentId]));
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

  // Sensors — small distance threshold so click vs drag stays predictable
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id ?? null;
    setDropTargetId(overId == null ? null : String(overId));

    // Auto-expand a tag when dragging over its row for >700ms
    if (!overId) {
      if (expandTimerRef.current) {
        window.clearTimeout(expandTimerRef.current.timer);
        expandTimerRef.current = null;
      }
      return;
    }
    const overStr = String(overId);
    if (!overStr.startsWith("tag:")) return;
    const tagId = overStr.slice(4);
    if (expanded.has(tagId)) return;
    if (expandTimerRef.current?.id === tagId) return;
    if (expandTimerRef.current) {
      window.clearTimeout(expandTimerRef.current.timer);
    }
    expandTimerRef.current = {
      id: tagId,
      timer: window.setTimeout(() => {
        setExpanded((s) => new Set([...s, tagId]));
        expandTimerRef.current = null;
      }, 700),
    };
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDropTargetId(null);
    if (expandTimerRef.current) {
      window.clearTimeout(expandTimerRef.current.timer);
      expandTimerRef.current = null;
    }
    if (!event.over) return;
    const fromData = event.active.data.current as DragData | undefined;
    const overId = String(event.over.id);
    if (!fromData) return;

    if (fromData.kind === "tag" && overId.startsWith("tag:")) {
      // Tag → Tag = re-parent
      const newParentId = overId.slice(4);
      if (newParentId === fromData.id) return;
      try {
        await api.updateTag(fromData.id, { parent_id: newParentId });
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    } else if (fromData.kind === "tag" && overId === "tag:__root__") {
      // Tag → root = clear parent
      try {
        await api.updateTag(fromData.id, { parent_id: null });
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    } else if (fromData.kind === "card" && overId.startsWith("tag:")) {
      // Card → Tag = assign
      const newTagId = overId.slice(4);
      if (newTagId === "__root__") return;
      try {
        await api.assignTag(newTagId, fromData.id);
        // If dragged from a different tag, unassign from origin (move semantics).
        if (fromData.parentTagId && fromData.parentTagId !== newTagId) {
          await api.unassignTag(fromData.parentTagId, fromData.id);
        }
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  const isUntaggedActive = params.get("untagged") === "1";
  const isAllActive = !activeTag && !isUntaggedActive;

  return (
    <DndContext sensors={sensors} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="space-y-0.5 px-2 text-xs">
        {error && (
          <p className="mx-2 mb-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
            {error}
          </p>
        )}

        {/* Root drop zone — drop a tag here to make it top-level */}
        <RootDropZone active={dropTargetId === "tag:__root__"}>
          <Row
            active={isAllActive}
            onClick={() => select(null)}
            label={t("nav.allCards")}
            countLabel=""
            depth={0}
          />
        </RootDropZone>

        {tree.map((node) => (
          <TreeBranch
            key={node.tag.id}
            node={node}
            depth={0}
            activeTag={activeTag}
            expanded={expanded}
            dropTargetId={dropTargetId}
            onToggle={toggle}
            onSelectTag={(name) => select(name)}
            onSelectCard={(id) => navigate(`/cards/${id}`)}
            onAddChild={(parentId) => startCreate(parentId)}
            creatingUnder={creatingUnder}
            newName={newName}
            setNewName={setNewName}
            submitCreate={submitCreate}
            cancelCreate={cancelCreate}
            busy={busy}
          />
        ))}

        {creatingTopLevel && (
          <CreateInput
            depth={0}
            name={newName}
            onChange={setNewName}
            onSubmit={submitCreate}
            onCancel={cancelCreate}
            busy={busy}
          />
        )}

        <div className="mt-2 space-y-0.5">
          <button
            type="button"
            onClick={() => startCreate(null)}
            className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
          >
            <Plus className="h-3 w-3" />
            {t("tags.newTag")}
          </button>

          {data && data.untagged.length > 0 && (
            <>
              <Row
                active={isUntaggedActive}
                onClick={() => select(null, true)}
                label={t("tags.untagged")}
                italic
                countLabel={String(data.untagged.length)}
                depth={0}
                icon={Inbox}
                expandable
                expanded={expanded.has("__untagged__")}
                onToggleExpand={() => toggle("__untagged__")}
              />
              {expanded.has("__untagged__") &&
                data.untagged.slice(0, 50).map((card) => (
                  <CardLeaf
                    key={card.id}
                    card={card}
                    parentTagId={null}
                    depth={1}
                    onClick={() => navigate(`/cards/${card.id}`)}
                  />
                ))}
            </>
          )}
        </div>

        {loading && (
          <div className="px-2 py-1 text-[10px] text-ink-500">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {t("common.loading")}
          </div>
        )}
      </div>
    </DndContext>
  );
}

function TreeBranch({
  node,
  depth,
  activeTag,
  expanded,
  dropTargetId,
  onToggle,
  onSelectTag,
  onSelectCard,
  onAddChild,
  creatingUnder,
  newName,
  setNewName,
  submitCreate,
  cancelCreate,
  busy,
}: {
  node: TreeNode;
  depth: number;
  activeTag: string | null;
  expanded: Set<string>;
  dropTargetId: string | null;
  onToggle: (id: string) => void;
  onSelectTag: (name: string) => void;
  onSelectCard: (id: string) => void;
  onAddChild: (parentId: string) => void;
  creatingUnder: string | null;
  newName: string;
  setNewName: (v: string) => void;
  submitCreate: () => void;
  cancelCreate: () => void;
  busy: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const hasCards = node.tag.cards.length > 0;
  const isExpanded = expanded.has(node.tag.id);
  const isActive = activeTag === node.tag.name;
  const expandable = hasChildren || hasCards;
  const tagDropId = `tag:${node.tag.id}`;

  return (
    <>
      <DraggableTagRow
        tag={node.tag}
        depth={depth}
        isActive={isActive}
        expandable={expandable}
        expanded={isExpanded}
        onToggleExpand={() => onToggle(node.tag.id)}
        onClick={() => onSelectTag(node.tag.name)}
        onAddChild={() => onAddChild(node.tag.id)}
        countLabel={String(node.totalCount)}
        isDropTarget={dropTargetId === tagDropId}
      />

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeBranch
              key={child.tag.id}
              node={child}
              depth={depth + 1}
              activeTag={activeTag}
              expanded={expanded}
              dropTargetId={dropTargetId}
              onToggle={onToggle}
              onSelectTag={onSelectTag}
              onSelectCard={onSelectCard}
              onAddChild={onAddChild}
              creatingUnder={creatingUnder}
              newName={newName}
              setNewName={setNewName}
              submitCreate={submitCreate}
              cancelCreate={cancelCreate}
              busy={busy}
            />
          ))}

          {node.tag.cards.map((card) => (
            <CardLeaf
              key={card.id}
              card={card}
              parentTagId={node.tag.id}
              depth={depth + 1}
              onClick={() => onSelectCard(card.id)}
            />
          ))}

          {creatingUnder === node.tag.id && (
            <CreateInput
              depth={depth + 1}
              name={newName}
              onChange={setNewName}
              onSubmit={submitCreate}
              onCancel={cancelCreate}
              busy={busy}
            />
          )}
        </>
      )}
    </>
  );
}

function DraggableTagRow({
  tag,
  depth,
  isActive,
  expandable,
  expanded,
  onToggleExpand,
  onClick,
  onAddChild,
  countLabel,
  isDropTarget,
}: {
  tag: TagWithCards;
  depth: number;
  isActive: boolean;
  expandable: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onClick: () => void;
  onAddChild: () => void;
  countLabel: string;
  isDropTarget: boolean;
}) {
  const dragId = `tag:${tag.id}`;
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({
    id: dragId,
    data: { kind: "tag", id: tag.id } as DragData,
  });
  const { setNodeRef: setDrop } = useDroppable({ id: dragId });

  return (
    <div
      ref={(el) => {
        setDrag(el);
        setDrop(el);
      }}
      {...attributes}
      {...listeners}
      className={[
        "group relative flex items-center gap-1 rounded-md pr-1 transition",
        isActive
          ? "bg-ink-700/70 text-ink-100"
          : isDropTarget
          ? "bg-emerald-500/15 text-ink-100 ring-1 ring-emerald-500/40"
          : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-ink-500 hover:text-ink-100"
          aria-label="toggle"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ChevronRight
            className={[
              "h-3 w-3 transition-transform",
              expanded ? "rotate-90" : "rotate-0",
            ].join(" ")}
          />
        </button>
      ) : (
        <span className="w-4" />
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Hash className="h-3 w-3 flex-shrink-0 text-ink-500" />
        <span className="truncate">{tag.name}</span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddChild();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-ink-500 opacity-0 transition hover:bg-ink-700 hover:text-ink-100 group-hover:opacity-100"
        title="Add sub-tag"
      >
        <Plus className="h-3 w-3" />
      </button>

      {countLabel && (
        <span
          className={[
            "ml-1 rounded-full px-1.5 text-[9px] font-medium tabular-nums",
            isActive ? "bg-ink-100/15 text-ink-100" : "text-ink-500",
          ].join(" ")}
        >
          {countLabel}
        </span>
      )}
    </div>
  );
}

function CardLeaf({
  card,
  parentTagId,
  depth,
  onClick,
}: {
  card: TagCard;
  parentTagId: string | null;
  depth: number;
  onClick: () => void;
}) {
  const Icon = SOURCE_ICONS[card.source_type] ?? Type;
  const dragId = `card:${card.id}:${parentTagId ?? "untagged"}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { kind: "card", id: card.id, parentTagId } as DragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        "group flex items-center gap-1.5 rounded-md py-1 pr-1 text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
      style={{ paddingLeft: 6 + depth * 12 + 16 }}
    >
      <button
        type="button"
        onClick={onClick}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {card.thumbnail_url ? (
          <img
            src={card.thumbnail_url}
            alt=""
            className="h-3.5 w-5 flex-shrink-0 rounded-sm object-cover"
          />
        ) : (
          <div className="flex h-3.5 w-5 flex-shrink-0 items-center justify-center rounded-sm bg-ink-800">
            <Icon className="h-2.5 w-2.5 text-ink-500" />
          </div>
        )}
        <span className="truncate text-[11px]">{card.title}</span>
      </button>
    </div>
  );
}

function RootDropZone({ children, active }: { children: React.ReactNode; active: boolean }) {
  const { setNodeRef } = useDroppable({ id: "tag:__root__" });
  return (
    <div
      ref={setNodeRef}
      className={active ? "rounded-md ring-1 ring-emerald-500/40 bg-emerald-500/5" : ""}
    >
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  label,
  countLabel,
  depth,
  expandable,
  expanded,
  onToggleExpand,
  italic,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  countLabel: string;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  italic?: boolean;
  icon?: FC<{ className?: string }>;
}) {
  const Indent = Icon ?? Hash;
  return (
    <div
      className={[
        "group relative flex items-center gap-1 rounded-md pr-1 transition",
        active
          ? "bg-ink-700/70 text-ink-100"
          : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
      ].join(" ")}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-ink-500 hover:text-ink-100"
          aria-label="toggle"
        >
          <ChevronRight
            className={[
              "h-3 w-3 transition-transform",
              expanded ? "rotate-90" : "rotate-0",
            ].join(" ")}
          />
        </button>
      ) : (
        <span className="w-4" />
      )}

      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
      >
        {!italic && <Indent className="h-3 w-3 flex-shrink-0 text-ink-500" />}
        {italic && <Indent className="h-3 w-3 flex-shrink-0 text-ink-400" />}
        <span className={["truncate", italic ? "italic text-ink-400" : ""].join(" ")}>
          {label}
        </span>
      </button>

      {countLabel && (
        <span
          className={[
            "ml-1 rounded-full px-1.5 text-[9px] font-medium tabular-nums",
            active ? "bg-ink-100/15 text-ink-100" : "text-ink-500",
          ].join(" ")}
        >
          {countLabel}
        </span>
      )}
    </div>
  );
}

function CreateInput({
  depth,
  name,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  depth: number;
  name: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative flex items-center gap-1"
      style={{ paddingLeft: 6 + depth * 12 + 16 }}
    >
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

function buildTree(tags: TagWithCards[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const tag of tags) {
    nodes.set(tag.id, { tag, children: [], totalCount: tag.count });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.tag.parent_id && nodes.has(node.tag.parent_id)) {
      nodes.get(node.tag.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const visit = (node: TreeNode): number => {
    let total = node.tag.cards.length;
    for (const c of node.children) total += visit(c);
    node.totalCount = total;
    node.children.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
    return total;
  };
  for (const r of roots) visit(r);
  roots.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
  return roots;
}
