import {
  ArrowDown,
  ArrowUp,
  Disc3,
  Headphones,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import RichTextEditor from "../components/RichTextEditor";
import {
  api,
  tokenStorage,
  type CardListItem,
  type PodcastPlaylistDetail,
  type PodcastPlaylistOut,
} from "../lib/api";
import { playSound } from "../lib/sounds";

const VOICES = ["Kore", "Puck", "Enceladus", "Charon", "Fenrir"];

export default function PodcastsPage() {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<PodcastPlaylistOut[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PodcastPlaylistDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshPlaylists = useCallback(async () => {
    try {
      const list = await api.listPlaylists();
      setPlaylists(list);
      if (!activeId && list.length > 0) setActiveId(list[0].id);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [activeId]);

  useEffect(() => {
    void refreshPlaylists();
  }, [refreshPlaylists]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api.getPlaylist(activeId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    try {
      const pl = await api.createPlaylist(name);
      setPlaylists((prev) => [pl, ...prev]);
      setActiveId(pl.id);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onPlaylistDeleted = (id: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
  };

  return (
    <div className="flex h-full">
      <PlaylistSidebar
        playlists={playlists}
        activeId={activeId}
        onPick={setActiveId}
        creating={creating}
        newName={newName}
        setNewName={setNewName}
        onStartCreate={() => {
          playSound("click");
          setCreating(true);
        }}
        onSubmitCreate={submitCreate}
        onCancelCreate={() => {
          setCreating(false);
          setNewName("");
        }}
      />

      <div className="flex flex-1 min-w-0 flex-col">
        <div className="page-header">
          <div className="page-header-inner">
            <h1 className="page-header-title">{t("nav.podcasts")}</h1>
            <p className="page-header-subtitle">
              {t("podcastPage.subtitle", {
                defaultValue: "Build playlists, generate narrated episodes with cover art.",
              })}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-8 pb-12 pt-6">
            {error && (
              <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {detail ? (
              <PlaylistDetailView
                detail={detail}
                onChange={setDetail}
                onDeleted={onPlaylistDeleted}
                onError={setError}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaylistSidebar({
  playlists,
  activeId,
  onPick,
  creating,
  newName,
  setNewName,
  onStartCreate,
  onSubmitCreate,
  onCancelCreate,
}: {
  playlists: PodcastPlaylistOut[];
  activeId: string | null;
  onPick: (id: string) => void;
  creating: boolean;
  newName: string;
  setNewName: (v: string) => void;
  onStartCreate: () => void;
  onSubmitCreate: () => void;
  onCancelCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="panel-elevated hidden md:flex w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
          {t("podcastPage.playlists", { defaultValue: "Playlists" })}
        </span>
        <button
          type="button"
          onClick={onStartCreate}
          title={t("podcastPage.newPlaylist", { defaultValue: "New playlist" }) ?? ""}
          className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[10px] font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          <Plus className="h-3 w-3" />
          {t("tags.new", { defaultValue: "New" })}
        </button>
      </div>
      {creating && (
        <div className="border-b border-ink-800 px-3 py-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitCreate();
              if (e.key === "Escape") onCancelCreate();
            }}
            placeholder={t("podcastPage.playlistNamePlaceholder", { defaultValue: "Playlist name…" }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
          />
        </div>
      )}
      <ul className="flex-1 overflow-y-auto py-2">
        {playlists.length === 0 ? (
          <li className="px-4 py-6 text-center text-[11px] text-ink-500">
            {t("podcastPage.noPlaylists", { defaultValue: "No playlists yet" })}
          </li>
        ) : (
          playlists.map((p) => {
            const isActive = p.id === activeId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className={[
                    "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-xs transition",
                    isActive
                      ? "bg-ink-700/70 text-ink-100"
                      : "text-ink-300 hover:bg-ink-800",
                  ].join(" ")}
                >
                  <span className="flex w-full items-center gap-1.5 truncate font-medium">
                    <Headphones className="h-3 w-3 flex-shrink-0 text-ink-400" />
                    {p.name}
                  </span>
                  <span className="text-[10px] text-ink-500">
                    {p.card_count}{" "}
                    {t("podcastPage.cards", { defaultValue: "cards", count: p.card_count })}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-700 bg-ink-800/30 p-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-700/50">
        <Disc3 className="h-6 w-6 text-ink-300" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-ink-100">
          {t("podcastPage.empty.title", { defaultValue: "No playlist selected" })}
        </h2>
        <p className="mt-1 text-sm text-ink-400">
          {t("podcastPage.empty.body", {
            defaultValue: "Create a new playlist on the left to get started.",
          })}
        </p>
      </div>
    </div>
  );
}

function PlaylistDetailView({
  detail,
  onChange,
  onDeleted,
  onError,
}: {
  detail: PodcastPlaylistDetail;
  onChange: (d: PodcastPlaylistDetail) => void;
  onDeleted: (id: string) => void;
  onError: (err: string) => void;
}) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [produceBusy, setProduceBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [voice, setVoice] = useState("Kore");
  const [generateCover, setGenerateCover] = useState(true);
  const [targetMinutes, setTargetMinutes] = useState(5);

  const wipeDraft = () => {
    setDraftTitle("");
    setDraftText("");
  };

  const remove = async () => {
    if (!window.confirm(t("podcastPage.confirmDelete", { defaultValue: "Delete this playlist? Episodes will be removed." }) ?? "")) {
      return;
    }
    try {
      await api.deletePlaylist(detail.id);
      onDeleted(detail.id);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const moveCard = async (idx: number, dir: -1 | 1) => {
    const next = [...detail.cards];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    try {
      const updated = await api.reorderPlaylist(
        detail.id,
        next.map((c) => c.card_id),
      );
      onChange(updated);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const removeCard = async (cardId: string) => {
    try {
      const updated = await api.removePlaylistCard(detail.id, cardId);
      onChange(updated);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const generateDraft = async () => {
    if (detail.cards.length === 0) return;
    setDraftBusy(true);
    try {
      const result = await api.draftEpisode(detail.id, targetMinutes);
      setDraftTitle(result.title);
      setDraftText(result.narrative_text);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDraftBusy(false);
    }
  };

  const produce = async () => {
    if (!draftTitle.trim() || draftText.trim().length < 20) return;
    setProduceBusy(true);
    try {
      await api.produceEpisode(detail.id, {
        title: draftTitle.trim(),
        narrative_text: draftText,
        voice,
        generate_cover: generateCover,
      });
      // refresh
      const updated = await api.getPlaylist(detail.id);
      onChange(updated);
      wipeDraft();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setProduceBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink-100">{detail.name}</h2>
          {detail.description && (
            <p className="mt-1 text-sm text-ink-400">{detail.description}</p>
          )}
          <p className="mt-1 text-[11px] text-ink-500">
            {detail.card_count}{" "}
            {t("podcastPage.cards", { defaultValue: "cards", count: detail.card_count })} ·{" "}
            {detail.episodes.length}{" "}
            {t("podcastPage.episodes", { defaultValue: "episodes", count: detail.episodes.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={remove}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3 w-3" />
          {t("common.delete")}
        </button>
      </header>

      {/* Cards */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-100">
            {t("podcastPage.cardsHeading", { defaultValue: "Cards in this playlist" })}
          </h3>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200"
          >
            <Plus className="h-3 w-3" />
            {t("podcastPage.addCard", { defaultValue: "Add card" })}
          </button>
        </div>
        {detail.cards.length === 0 ? (
          <p className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-4 py-6 text-center text-xs text-ink-400">
            {t("podcastPage.noCards", { defaultValue: "No cards yet — add some to start drafting an episode." })}
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.cards.map((c, idx) => (
              <li
                key={c.card_id}
                className="surface-soft flex items-center gap-3 rounded-md border border-ink-800 bg-ink-800/30 px-3 py-2"
              >
                <span className="text-[10px] tabular-nums text-ink-500 w-6">{idx + 1}.</span>
                {c.thumbnail_url && (
                  <img
                    src={c.thumbnail_url}
                    alt=""
                    className="h-8 w-12 flex-shrink-0 rounded-sm object-cover"
                  />
                )}
                <span className="flex-1 truncate text-xs text-ink-200">{c.title}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveCard(idx, -1)}
                    disabled={idx === 0}
                    className="rounded p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCard(idx, 1)}
                    disabled={idx === detail.cards.length - 1}
                    className="rounded p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCard(c.card_id)}
                    className="rounded p-1 text-ink-500 transition hover:bg-red-500/10 hover:text-red-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Draft / produce */}
      <section className="surface-soft space-y-4 rounded-xl border border-ink-800 bg-ink-800/40 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ink-300" />
          <h3 className="text-sm font-semibold text-ink-100">
            {t("podcastPage.composer", { defaultValue: "Episode composer" })}
          </h3>
        </div>

        {!draftText && (
          <div className="space-y-3">
            <p className="text-xs text-ink-300">
              {t("podcastPage.composerHint", {
                defaultValue:
                  "Generate a script that weaves all cards into one long-form spoken episode. You can edit it before producing audio.",
              })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[11px] text-ink-300">
                {t("podcastPage.targetMinutes", { defaultValue: "Target length" })}:
                <select
                  value={targetMinutes}
                  onChange={(e) => setTargetMinutes(Number(e.target.value))}
                  className="rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
                >
                  {[3, 5, 8, 12, 15, 20].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={generateDraft}
                disabled={detail.cards.length === 0 || draftBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
              >
                {draftBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {t("podcastPage.generateDraft", { defaultValue: "Generate draft script" })}
              </button>
            </div>
          </div>
        )}

        {draftText && (
          <div className="space-y-3">
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={t("podcastPage.episodeTitle", { defaultValue: "Episode title" }) ?? ""}
              className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-sm font-medium text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
            />
            <RichTextEditor
              markdown={draftText}
              onChange={setDraftText}
              placeholder={t("podcastPage.scriptPlaceholder", { defaultValue: "Episode script…" }) ?? ""}
              minHeight={320}
            />
            <div className="flex flex-wrap items-center gap-3 border-t border-ink-800 pt-3">
              <label className="flex items-center gap-2 text-[11px] text-ink-300">
                {t("podcastPage.voice", { defaultValue: "Voice" })}:
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
                >
                  {VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-ink-300">
                <input
                  type="checkbox"
                  checked={generateCover}
                  onChange={(e) => setGenerateCover(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <ImageIcon className="h-3 w-3" />
                {t("podcastPage.generateCover", { defaultValue: "Generate cover art" })}
              </label>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={wipeDraft}
                  disabled={produceBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1.5 text-[11px] text-ink-300 transition hover:bg-ink-800"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={produce}
                  disabled={produceBusy || !draftTitle.trim() || draftText.trim().length < 20}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {produceBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Disc3 className="h-3.5 w-3.5" />
                  )}
                  {produceBusy
                    ? t("podcastPage.producing", { defaultValue: "Producing…" })
                    : t("podcastPage.produce", { defaultValue: "Produce episode" })}
                </button>
              </div>
            </div>
            {produceBusy && (
              <p className="text-[11px] text-ink-400">
                {t("podcastPage.produceHint", {
                  defaultValue: "Synthesizing audio + generating cover art. ~30–60 s.",
                })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Episodes */}
      {detail.episodes.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink-100">
            {t("podcastPage.episodesHeading", { defaultValue: "Produced episodes" })}
          </h3>
          <div className="space-y-3">
            {detail.episodes.map((e) => (
              <EpisodeCard
                key={e.id}
                episode={e}
                onDelete={async () => {
                  try {
                    await api.deleteEpisode(detail.id, e.id);
                    const updated = await api.getPlaylist(detail.id);
                    onChange(updated);
                  } catch (err) {
                    onError((err as Error).message);
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {pickerOpen && (
        <CardPickerModal
          excludeIds={detail.cards.map((c) => c.card_id)}
          onPick={async (cardId) => {
            try {
              const updated = await api.addPlaylistCard(detail.id, cardId);
              onChange(updated);
            } catch (err) {
              onError((err as Error).message);
            }
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function EpisodeCard({
  episode,
  onDelete,
}: {
  episode: import("../lib/api").PodcastEpisodeOut;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [audioBlob, setAudioBlob] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const coverUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!episode.has_audio && !episode.has_cover) return;
    let cancelled = false;
    const token = tokenStorage.get();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const loadBlob = async (url: string, setter: (s: string) => void, ref: { current: string | null }) => {
      const resp = await fetch(url, { headers });
      if (!resp.ok || cancelled) return;
      const blob = await resp.blob();
      if (cancelled) return;
      const obj = URL.createObjectURL(blob);
      ref.current = obj;
      setter(obj);
    };

    if (episode.has_audio) {
      void loadBlob(api.episodeAudioUrl(episode.id), setAudioBlob, audioUrlRef);
    }
    if (episode.has_cover) {
      void loadBlob(api.episodeCoverUrl(episode.id), setCoverBlob, coverUrlRef);
    }
    return () => {
      cancelled = true;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
      audioUrlRef.current = null;
      coverUrlRef.current = null;
    };
  }, [episode.id, episode.has_audio, episode.has_cover]);

  return (
    <div className="surface-soft flex gap-4 rounded-xl border border-ink-800 bg-ink-800/40 p-4">
      <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-900">
        {coverBlob ? (
          <img src={coverBlob} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-ink-500" />
        )}
      </div>
      <div className="flex flex-1 min-w-0 flex-col justify-between gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-ink-100">{episode.title}</h4>
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              {episode.voice} · {new Date(episode.created_at).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-ink-500 transition hover:bg-red-500/10 hover:text-red-300"
            title={t("common.delete") ?? ""}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {audioBlob ? (
          <audio controls src={audioBlob} className="w-full" preload="metadata">
            <track kind="captions" />
          </audio>
        ) : (
          <p className="text-[11px] text-ink-500">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {t("common.loading")}
          </p>
        )}
      </div>
    </div>
  );
}

function CardPickerModal({
  excludeIds,
  onPick,
  onClose,
}: {
  excludeIds: string[];
  onPick: (cardId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CardListItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void api.listCards({ status: "completed" }).then(setCards);
  }, []);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const filtered = (cards ?? []).filter(
    (c) =>
      !exclude.has(c.id) &&
      (query.trim().length === 0 || c.title.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md"
      />
      <div className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 surface-elevated">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">
            {t("podcastPage.pickCard", { defaultValue: "Add a card to the playlist" })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-ink-700 p-3">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("podcastPage.searchCards", { defaultValue: "Search cards…" }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {cards === null ? (
            <p className="p-6 text-center text-xs text-ink-500">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              {t("common.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-ink-500">
              {t("podcastPage.noMoreCards", { defaultValue: "No cards left to add." })}
            </p>
          ) : (
            <ul>
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(c.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-700/40"
                  >
                    {c.thumbnail_url ? (
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        className="h-9 w-14 flex-shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <div className="h-9 w-14 flex-shrink-0 rounded-sm bg-ink-900" />
                    )}
                    <span className="flex-1 truncate text-xs text-ink-200">{c.title}</span>
                    <RefreshCw className="hidden h-3 w-3 text-ink-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
