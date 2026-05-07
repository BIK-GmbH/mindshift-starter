import { ChevronRight, Hash, Inbox, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, type TagWithCount } from "../lib/api";

interface TreeNode {
  tag: TagWithCount;
  children: TreeNode[];
  /** Sum of own count + all descendants' counts. */
  totalCount: number;
}

const EXPANDED_KEY = "mindshift.tagsExpanded";

export default function TagsTree() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const activeTag = params.get("tag");

  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [untagged, setUntagged] = useState<number>(0);
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

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, u] = await Promise.all([api.listTags(), api.untaggedCount()]);
      setTags(list);
      setUntagged(u.count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // re-fetch when path changes (e.g. after ingesting new content)
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const tree = useMemo(() => buildTree(tags), [tags]);

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
      // Make sure the parent is expanded so the input is visible
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

  const isUntaggedActive = params.get("untagged") === "1";
  const isAllActive = !activeTag && !isUntaggedActive;

  return (
    <div className="space-y-0.5 px-2 text-xs">
      {error && (
        <p className="mx-2 mb-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {error}
        </p>
      )}

      <Row
        active={isAllActive}
        onClick={() => select(null)}
        label={t("nav.allCards")}
        countLabel=""
        depth={0}
      />

      {/* Top-level tag tree */}
      {tree.map((node) => (
        <TreeBranch
          key={node.tag.id}
          node={node}
          depth={0}
          activeTag={activeTag}
          expanded={expanded}
          onToggle={toggle}
          onSelect={(name) => select(name)}
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

      {/* "+ new tag" + untagged + loading */}
      <div className="mt-2 space-y-0.5">
        <button
          type="button"
          onClick={() => startCreate(null)}
          className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <Plus className="h-3 w-3" />
          {t("tags.newTag")}
        </button>

        {untagged > 0 && (
          <Row
            active={isUntaggedActive}
            onClick={() => select(null, true)}
            label={t("tags.untagged")}
            italic
            countLabel={String(untagged)}
            depth={0}
            icon={Inbox}
          />
        )}
      </div>

      {loading && (
        <div className="px-2 py-1 text-[10px] text-ink-500">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          {t("common.loading")}
        </div>
      )}
    </div>
  );
}

function TreeBranch({
  node,
  depth,
  activeTag,
  expanded,
  onToggle,
  onSelect,
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
  onToggle: (id: string) => void;
  onSelect: (name: string) => void;
  onAddChild: (parentId: string) => void;
  creatingUnder: string | null;
  newName: string;
  setNewName: (v: string) => void;
  submitCreate: () => void;
  cancelCreate: () => void;
  busy: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.tag.id);
  const isActive = activeTag === node.tag.name;
  return (
    <>
      <Row
        active={isActive}
        onClick={() => onSelect(node.tag.name)}
        label={node.tag.name}
        countLabel={String(node.totalCount)}
        depth={depth}
        expandable={hasChildren}
        expanded={isExpanded}
        onToggleExpand={() => onToggle(node.tag.id)}
        onAddChild={() => onAddChild(node.tag.id)}
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
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              creatingUnder={creatingUnder}
              newName={newName}
              setNewName={setNewName}
              submitCreate={submitCreate}
              cancelCreate={cancelCreate}
              busy={busy}
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

function Row({
  active,
  onClick,
  label,
  countLabel,
  depth,
  expandable,
  expanded,
  onToggleExpand,
  onAddChild,
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
  onAddChild?: () => void;
  italic?: boolean;
  icon?: React.FC<{ className?: string }>;
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
        <span
          className={[
            "truncate",
            italic ? "italic text-ink-400" : "",
          ].join(" ")}
        >
          {label}
        </span>
      </button>

      {onAddChild && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild();
          }}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-ink-500 opacity-0 transition hover:bg-ink-700 hover:text-ink-100 group-hover:opacity-100"
          title="Add sub-tag"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}

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

function buildTree(tags: TagWithCount[]): TreeNode[] {
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
  // Bubble counts up the tree.
  const visit = (node: TreeNode): number => {
    let total = node.tag.count;
    for (const c of node.children) total += visit(c);
    node.totalCount = total;
    node.children.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
    return total;
  };
  for (const r of roots) visit(r);
  roots.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
  return roots;
}
