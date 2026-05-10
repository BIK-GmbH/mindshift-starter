import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Globe,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Lock,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import CardPickerModal from "../components/CardPickerModal";
import { useAuth } from "../lib/AuthContext";
import { useDialog } from "../lib/DialogContext";
import { api, type PathDetail } from "../lib/api";
import { useAuthedImage } from "../lib/useAuthedImage";

/**
 * Owner-only path editor. Three regions:
 *
 *  1. Header — title (inline-edit), description (inline-edit), public
 *     toggle + share-link, delete, "play" CTA.
 *  2. Card list — drag-free reorder via up/down arrows, per-step
 *     lesson note (inline-edit), remove button.
 *  3. Add-cards — opens the shared CardPickerModal.
 */
export default function PathEditPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirm } = useDialog();
  const { pathId = "" } = useParams<{ pathId: string }>();
  const navigate = useNavigate();
  const [path, setPath] = useState<PathDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Native HTML5 drag-drop state. We keep both indices so we can render
  // a drop indicator and skip the no-op when source == over.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const { src: coverSrc, refresh: refreshCover } = useAuthedImage(path?.cover_url ?? null);

  const fetchPath = useCallback(async () => {
    try {
      setPath(await api.getPath(pathId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pathId]);

  useEffect(() => {
    void fetchPath();
  }, [fetchPath]);

  const update = async (body: Parameters<typeof api.updatePath>[1]) => {
    setSaving(true);
    try {
      const next = await api.updatePath(pathId, body);
      setPath(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("paths.confirmDelete.title", { defaultValue: "Delete this path?" }) ?? "",
      body: t("paths.confirmDelete.body", {
        defaultValue: "The path will be removed; the cards stay in your library.",
      }) ?? "",
      danger: true,
      confirmLabel: t("common.delete") ?? "",
    });
    if (!ok) return;
    await api.deletePath(pathId);
    navigate("/paths");
  };

  const moveCard = async (cardId: string, dir: -1 | 1) => {
    if (!path) return;
    const ids = path.cards.map((c) => c.card_id);
    const idx = ids.indexOf(cardId);
    const newIdx = idx + dir;
    if (idx < 0 || newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    // Optimistic UI — re-render with the new order, server confirms.
    setPath({
      ...path,
      cards: ids.map((id, i) => {
        const original = path.cards.find((c) => c.card_id === id)!;
        return { ...original, position: i };
      }),
    });
    try {
      const next = await api.reorderPath(pathId, ids);
      setPath(next);
    } catch (err) {
      setError((err as Error).message);
      void fetchPath(); // revert
    }
  };

  const removeCard = async (cardId: string) => {
    const next = await api.removeCardFromPath(pathId, cardId);
    setPath(next);
  };

  const updateLesson = async (cardId: string, value: string) => {
    const next = await api.updatePathLesson(pathId, cardId, value || null);
    setPath(next);
  };

  const generateCover = async () => {
    setGeneratingCover(true);
    setError(null);
    try {
      const next = await api.generatePathCover(pathId);
      setPath(next);
      // Force the authed-image hook to re-fetch even if the URL string
      // is unchanged (regenerating overwrites the same file).
      refreshCover();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingCover(false);
    }
  };

  /**
   * Apply a finished drag — moves the card at `from` to `to` and posts
   * the new ordering. Optimistic UI; reverts on server error.
   */
  const handleDrop = async (from: number, to: number) => {
    if (!path) return;
    if (from === to) return;
    const ids = path.cards.map((c) => c.card_id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setPath({
      ...path,
      cards: ids.map((id, i) => {
        const original = path.cards.find((c) => c.card_id === id)!;
        return { ...original, position: i };
      }),
    });
    try {
      const next = await api.reorderPath(pathId, ids);
      setPath(next);
    } catch (err) {
      setError((err as Error).message);
      void fetchPath();
    }
  };

  const publicUrl = path && path.is_public && user?.username
    ? `${window.location.origin}/u/${user.username}/path/${path.slug}`
    : null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {error ?? t("paths.notFound", { defaultValue: "Path not found" })}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky title band */}
      <div className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/paths")}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            title={t("common.back") ?? ""}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <InlineTitle
            value={path.title}
            onCommit={(v) => update({ title: v })}
            saving={saving}
          />
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}/play`)}
            disabled={path.cards.length === 0}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-fuchsia-500/15 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition hover:bg-fuchsia-500/25 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {t("paths.play", { defaultValue: "Play" })}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 pb-16 pt-6">
          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}

          {/* Description */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {t("paths.description", { defaultValue: "Description" })}
            </h2>
            <InlineDescription
              value={path.description_md ?? ""}
              onCommit={(v) => update({ description_md: v })}
            />
          </section>

          {/* Cover */}
          <section className="rounded-xl border border-ink-800 bg-ink-800/30 p-4">
            <div className="flex items-start gap-4">
              <div className="aspect-[16/8] w-40 flex-shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-fuchsia-500/20 via-ink-800/40 to-ink-900/40 ring-1 ring-ink-700">
                {coverSrc ? (
                  <img src={coverSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-5 w-5 text-ink-600" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-300">
                  {t("paths.cover", { defaultValue: "Cover image" })}
                </h2>
                <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
                  {t("paths.coverHint", {
                    defaultValue: "Auto-generated from the path title, description and first few card titles. Costs one image-API call.",
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => void generateCover()}
                  disabled={generatingCover}
                  className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:opacity-60"
                >
                  {generatingCover ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generatingCover
                    ? t("paths.coverGenerating", { defaultValue: "Generiere…" })
                    : coverSrc
                      ? t("paths.regenerateCover", { defaultValue: "Regenerate" })
                      : t("paths.generateCover", { defaultValue: "Generate cover" })}
                </button>
              </div>
            </div>
          </section>

          {/* Visibility */}
          <section className="rounded-xl border border-ink-800 bg-ink-800/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-300">
                  {t("paths.visibility", { defaultValue: "Visibility" })}
                </h2>
                <p className="text-[11px] leading-relaxed text-ink-400">
                  {path.is_public
                    ? t("paths.publicHint", {
                        defaultValue: "Anyone with the link can read this path under your public profile.",
                      })
                    : t("paths.privateHint", {
                        defaultValue: "Only you can see this path. Toggle public to share it.",
                      })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void update({ is_public: !path.is_public })}
                className={[
                  "inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  path.is_public
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
                    : "border border-ink-700 text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                {path.is_public ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {path.is_public
                  ? t("paths.publicPill", { defaultValue: "Public" })
                  : t("paths.privatePill", { defaultValue: "Private" })}
              </button>
            </div>
            {publicUrl && (
              <div className="mt-3 flex items-center gap-1">
                <input
                  readOnly
                  value={publicUrl}
                  className="flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 font-mono text-[10px] text-ink-200"
                />
                <button
                  type="button"
                  title={t("tags.share.copy") ?? ""}
                  onClick={async () => {
                    await navigator.clipboard.writeText(publicUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded-md border transition",
                    copied
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-ink-700 text-ink-300 hover:bg-ink-800",
                  ].join(" ")}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800"
                  title={t("tags.share.open") ?? ""}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </section>

          {/* Card list */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {t("paths.steps", { defaultValue: "Steps" })}{" "}
                <span className="ml-1 text-ink-500">({path.cards.length})</span>
              </h2>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <Plus className="h-3 w-3" />
                {t("paths.addCards", { defaultValue: "Add cards" })}
              </button>
            </div>
            {path.cards.length === 0 ? (
              <p className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-4 py-8 text-center text-xs text-ink-400">
                {t("paths.emptySteps", {
                  defaultValue: "No steps yet — add cards to start building.",
                })}
              </p>
            ) : (
              <ul className="space-y-2">
                {path.cards.map((c, i) => (
                  <li
                    key={c.card_id}
                    onDragOver={(e) => {
                      if (dragIndex === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overIndex !== i) setOverIndex(i);
                    }}
                    onDragLeave={() => {
                      if (overIndex === i) setOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) void handleDrop(dragIndex, i);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    className={[
                      "rounded-xl border bg-ink-800/30 p-3 transition",
                      dragIndex === i ? "opacity-40" : "",
                      overIndex === i && dragIndex !== i
                        ? "border-fuchsia-500/60 ring-2 ring-fuchsia-500/20"
                        : "border-ink-800",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      {/* Drag handle — only the handle is draggable so
                          the lesson textarea stays editable. */}
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDragIndex(i);
                          e.dataTransfer.effectAllowed = "move";
                          // Required by Firefox to actually start the drag.
                          e.dataTransfer.setData("text/plain", c.card_id);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setOverIndex(null);
                        }}
                        title={t("paths.drag", { defaultValue: "Drag to reorder" }) ?? ""}
                        className="flex h-7 w-4 flex-shrink-0 cursor-grab items-center justify-center rounded text-ink-500 transition hover:text-ink-200 active:cursor-grabbing"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-fuchsia-500/15 text-[11px] font-bold tabular-nums text-fuchsia-200 ring-1 ring-fuchsia-500/30">
                        {i + 1}
                      </span>
                      {c.thumbnail_url ? (
                        <img
                          src={c.thumbnail_url}
                          alt=""
                          className="h-10 w-16 flex-shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-16 flex-shrink-0 rounded bg-ink-800" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-100">{c.title}</p>
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
                          {c.source_type}
                        </p>
                        <LessonField
                          value={c.lesson_md ?? ""}
                          onCommit={(v) => updateLesson(c.card_id, v)}
                        />
                      </div>
                      <div className="flex flex-shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => void moveCard(c.card_id, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-ink-700 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
                          title={t("paths.moveUp", { defaultValue: "Move up" }) ?? ""}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={i === path.cards.length - 1}
                          onClick={() => void moveCard(c.card_id, 1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-ink-700 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
                          title={t("paths.moveDown", { defaultValue: "Move down" }) ?? ""}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeCard(c.card_id)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-ink-700 text-ink-400 transition hover:bg-red-500/10 hover:text-red-300"
                          title={t("common.delete") ?? ""}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Danger zone */}
          <section className="border-t border-ink-800 pt-4">
            <button
              type="button"
              onClick={() => void remove()}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20"
            >
              <Trash2 className="h-3 w-3" />
              {t("paths.deletePath", { defaultValue: "Delete path" })}
            </button>
          </section>
        </div>
      </div>

      <CardPickerModal
        open={pickerOpen}
        alreadyIn={new Set(path.cards.map((c) => c.card_id))}
        onClose={() => setPickerOpen(false)}
        onPick={async (cardIds) => {
          const next = await api.addCardsToPath(pathId, cardIds);
          setPath(next);
        }}
      />
    </div>
  );
}

/* ---------------- inline-editing helpers ---------------- */

function InlineTitle({
  value,
  onCommit,
  saving,
}: {
  value: string;
  onCommit: (v: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== value) onCommit(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-base font-semibold text-ink-100 focus:border-ink-500 focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="min-w-0 flex-1 truncate text-left text-base font-semibold text-ink-100 transition hover:text-fuchsia-300"
    >
      {value}
      {saving && <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-ink-500" />}
    </button>
  );
}

function InlineDescription({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      placeholder="Describe what someone will learn from this path…"
      rows={3}
      className="w-full rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
    />
  );
}

function LessonField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      placeholder="Optional note for this step…"
      rows={1}
      className="w-full resize-none rounded border border-ink-800 bg-ink-900/60 px-2 py-1 text-[11px] text-ink-200 placeholder:text-ink-600 focus:border-ink-500 focus:outline-none"
    />
  );
}
