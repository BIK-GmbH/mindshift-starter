import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Disc3,
  ExternalLink,
  Hash,
  Headphones,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import PageHeader from "../components/PageHeader";
import RichTextEditor from "../components/RichTextEditor";
import { useDialog } from "../lib/DialogContext";
import {
  api,
  tokenStorage,
  type CardListItem,
  type EpisodeShareOut,
  type PodcastPlaylistDetail,
  type PodcastPlaylistOut,
} from "../lib/api";
import { playSound } from "../lib/sounds";

const VOICES = ["Kore", "Puck", "Enceladus", "Charon", "Fenrir"];

export default function PodcastsPage() {
  // Two modes share this component, mirroring the Paths page:
  //   /podcasts              → list of all playlists (tile grid)
  //   /podcasts/:playlistId  → that playlist's editor + episodes
  // The detail-side keeps its own data fetch + polling; the list side
  // only needs the lightweight summaries.
  const { playlistId } = useParams<{ playlistId: string }>();
  return playlistId ? (
    <PodcastDetailScreen playlistId={playlistId} />
  ) : (
    <PodcastListScreen />
  );
}

/* ----------------------------------------------------------------------
 * List screen — tile grid of every playlist + Plus/Hash actions.
 * -------------------------------------------------------------------- */
function PodcastListScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<PodcastPlaylistOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    try {
      const list = await api.listPlaylists();
      setPlaylists(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlaylists();
  }, [fetchPlaylists]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const pl = await api.createPlaylist(
        t("podcastPage.untitled", { defaultValue: "Untitled playlist" }) ?? "Untitled playlist",
      );
      navigate(`/podcasts/${pl.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Headphones}
        tone="sky"
        title={t("nav.podcasts")}
        subtitle={t("podcastPage.subtitle", {
          defaultValue:
            "Stelle dir Playlists aus deinen Cards zusammen und lass daraus erzählte Podcast-Episoden mit Cover-Art generieren.",
        })}
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                playSound("click");
                setTagPickerOpen(true);
              }}
              aria-label={t("podcastPage.fromTagTitle", { defaultValue: "Create playlist from a tag" }) ?? "From tag"}
              title={t("podcastPage.fromTagTitle", { defaultValue: "Create playlist from a tag" }) ?? ""}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 sm:h-auto sm:w-auto sm:gap-1.5 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-xs sm:font-medium"
            >
              <Hash className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("podcastPage.fromTag", { defaultValue: "From tag" })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating}
              aria-label={t("podcastPage.newPlaylist", { defaultValue: "New playlist" }) ?? "New playlist"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-900 transition hover:bg-ink-200 disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-1.5 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-xs sm:font-semibold"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {t("podcastPage.newPlaylist", { defaultValue: "New playlist" })}
              </span>
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-6">
          {error && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </div>
          ) : playlists.length === 0 ? (
            <ListEmptyState />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {playlists.map((p) => (
                <li key={p.id}>
                  <PlaylistTile playlist={p} onOpen={() => navigate(`/podcasts/${p.id}`)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {tagPickerOpen && (
        <TagToPlaylistModal
          onClose={() => setTagPickerOpen(false)}
          onCreated={(pl) => {
            setTagPickerOpen(false);
            navigate(`/podcasts/${pl.id}`);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function PlaylistTile({
  playlist,
  onOpen,
}: {
  playlist: PodcastPlaylistOut;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/30 text-left transition hover:border-sky-500/40 hover:bg-ink-800/50"
    >
      <div className="flex aspect-[16/8] w-full items-center justify-center bg-gradient-to-br from-sky-500/20 via-ink-800/40 to-ink-900/40">
        <Disc3 className="h-10 w-10 text-sky-300/60 transition group-hover:text-sky-300" />
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-center gap-2">
          {playlist.has_draft && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
              {t("podcastPage.hasDraft", { defaultValue: "Draft" })}
            </span>
          )}
        </div>
        <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-ink-100 group-hover:text-sky-300">
          {playlist.name}
        </h3>
        {playlist.description && (
          <p className="line-clamp-2 text-[11px] text-ink-400">{playlist.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10px] uppercase tracking-wider text-ink-500">
          <span>
            {playlist.card_count}{" "}
            {t("podcastPage.cards", { defaultValue: "cards", count: playlist.card_count })}
          </span>
        </div>
      </div>
    </button>
  );
}

function ListEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-6 py-12 text-center">
      <Disc3 className="mx-auto mb-3 h-8 w-8 text-ink-600" />
      <p className="mb-2 text-sm text-ink-200">
        {t("podcastPage.empty.title", { defaultValue: "No playlists yet" })}
      </p>
      <p className="text-xs text-ink-400">
        {t("podcastPage.empty.body", {
          defaultValue: "Erstelle deine erste Playlist über das Plus-Symbol oben rechts.",
        })}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Detail screen — single playlist editor + episode list.
 *
 * Layout mirrors PathEditPage: a sticky raw `page-header` band carrying
 * the back-button on the left, the inline-editable playlist name in the
 * middle, and the delete action on the right. The body below is the
 * existing PlaylistDetailView with its own internal header stripped.
 * -------------------------------------------------------------------- */
function PodcastDetailScreen({ playlistId }: { playlistId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const [detail, setDetail] = useState<PodcastPlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .getPlaylist(playlistId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setNameDraft(d.name);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  // Same per-detail polling logic as before: re-run when the set of
  // processing episode ids changes.
  const processingKey =
    detail?.episodes
      .filter((e) => e.status === "processing")
      .map((e) => e.id)
      .join(",") ?? "";
  useEffect(() => {
    if (!detail || !processingKey) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const d = await api.getPlaylist(detail.id);
        if (!cancelled) setDetail(d);
      } catch {
        /* try again next round */
      }
    };
    const timer = window.setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [processingKey, detail?.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const saveName = async () => {
    if (!detail) return;
    const next = nameDraft.trim();
    if (!next || next === detail.name) {
      setEditingName(false);
      setNameDraft(detail.name);
      return;
    }
    setSavingName(true);
    try {
      await api.updatePlaylist(detail.id, { name: next });
      setDetail({ ...detail, name: next });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditingName(false);
      setSavingName(false);
    }
  };

  const removePlaylist = async () => {
    if (!detail) return;
    const ok = await confirm({
      title:
        t("podcastPage.confirmDeleteTitle", { defaultValue: "Delete this playlist?" }) ??
        "Delete this playlist?",
      body:
        t("podcastPage.confirmDeleteBody", {
          defaultValue:
            "All produced episodes (audio files + cover art) under this playlist will be removed permanently. This cannot be undone.",
        }) ?? "",
      confirmLabel: t("common.delete") ?? "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePlaylist(detail.id);
      navigate("/podcasts");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Sticky title band — same anatomy as PathEditPage so both detail
          surfaces feel like the same family of screens. */}
      <div className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/podcasts")}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            title={t("common.back") ?? ""}
            aria-label={t("podcastPage.backToList", { defaultValue: "Back to playlists" }) ?? "Back"}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                autoFocus
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveName();
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                    setNameDraft(detail?.name ?? "");
                  }
                }}
                className="w-full border-0 bg-transparent p-0 page-header-title font-semibold text-ink-100 outline-none focus:ring-0"
              />
            ) : (
              <h1
                onClick={() => detail && setEditingName(true)}
                className={[
                  "page-header-title truncate font-semibold text-ink-100 transition",
                  detail ? "cursor-text hover:text-ink-200" : "",
                ].join(" ")}
                title={t("podcastPage.editName", { defaultValue: "Click to rename" }) ?? ""}
              >
                {detail?.name ?? t("common.loading")}
              </h1>
            )}
            {detail && (
              <p className="page-header-subtitle text-ink-500">
                {detail.card_count}{" "}
                {t("podcastPage.cards", { defaultValue: "cards", count: detail.card_count })} ·{" "}
                {detail.episodes.length}{" "}
                {t("podcastPage.episodes", { defaultValue: "episodes", count: detail.episodes.length })}
              </p>
            )}
          </div>
          {detail && (
            <button
              type="button"
              onClick={() => void removePlaylist()}
              disabled={savingName}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              title={t("common.delete") ?? ""}
              aria-label={t("common.delete") ?? "Delete"}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("common.delete")}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 pb-12 pt-6 sm:px-8">
          {error && (
            <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
          {loading && !detail ? (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </div>
          ) : detail ? (
            <PlaylistDetailView
              detail={detail}
              onChange={setDetail}
              onError={setError}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlaylistDetailView({
  detail,
  onChange,
  onError,
}: {
  detail: PodcastPlaylistDetail;
  onChange: (d: PodcastPlaylistDetail) => void;
  onError: (err: string) => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [produceBusy, setProduceBusy] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(detail.description ?? "");

  const saveDescription = async () => {
    const next = descDraft.trim();
    if (next === (detail.description ?? "")) {
      setEditingDescription(false);
      return;
    }
    try {
      await api.updatePlaylist(detail.id, { description: next });
      onChange({ ...detail, description: next || null });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setEditingDescription(false);
    }
  };
  // Hydrate from server-persisted draft so navigating away doesn't lose
  // the script. The detail prop changes when the user switches playlists,
  // so this useState's initializer would NOT re-run; we sync via effect.
  const [draftTitle, setDraftTitle] = useState(detail.draft_title ?? "");
  const [draftText, setDraftText] = useState(detail.draft_narrative_text ?? "");
  const [voice, setVoice] = useState("Kore");
  const [draftLanguage, setDraftLanguage] = useState("");
  const [generateCover, setGenerateCover] = useState(true);
  const [coverStyle, setCoverStyle] = useState("");
  const [coverText, setCoverText] = useState("");
  const [coverSuggestBusy, setCoverSuggestBusy] = useState(false);

  const suggestCover = async () => {
    if (!draftTitle.trim() || draftText.trim().length < 20) return;
    setCoverSuggestBusy(true);
    try {
      const out = await api.suggestCoverMeta(draftTitle.trim(), draftText);
      setCoverStyle(out.cover_style);
      setCoverText(out.cover_text);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCoverSuggestBusy(false);
    }
  };
  const [targetMinutes, setTargetMinutes] = useState(detail.draft_target_minutes ?? 5);
  const [draftSaving, setDraftSaving] = useState(false);
  const lastSavedRef = useRef<{ title: string; text: string } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  // When the active playlist changes, replace the in-memory editor state
  // with that playlist's persisted draft.
  useEffect(() => {
    setDraftTitle(detail.draft_title ?? "");
    setDraftText(detail.draft_narrative_text ?? "");
    setTargetMinutes(detail.draft_target_minutes ?? 5);
    lastSavedRef.current = {
      title: detail.draft_title ?? "",
      text: detail.draft_narrative_text ?? "",
    };
    setEditingDescription(false);
    setDescDraft(detail.description ?? "");
  }, [detail.id, detail.draft_title, detail.draft_narrative_text, detail.draft_target_minutes, detail.description]);

  // Debounced auto-save: 1 s after the user stops typing, push the draft
  // to the server. Skip if nothing actually changed.
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (!draftText && !draftTitle) return;
    const last = lastSavedRef.current;
    if (last && last.title === draftTitle && last.text === draftText) return;

    saveTimerRef.current = window.setTimeout(() => {
      setDraftSaving(true);
      api
        .updatePlaylist(detail.id, {
          draft_title: draftTitle,
          draft_narrative_text: draftText,
          draft_target_minutes: targetMinutes,
        })
        .then(() => {
          lastSavedRef.current = { title: draftTitle, text: draftText };
        })
        .catch((err) => onError((err as Error).message))
        .finally(() => setDraftSaving(false));
    }, 1000);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTitle, draftText, targetMinutes, detail.id]);

  const wipeDraft = async () => {
    setDraftTitle("");
    setDraftText("");
    lastSavedRef.current = { title: "", text: "" };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    try {
      await api.updatePlaylist(detail.id, {
        draft_title: "",
        draft_narrative_text: "",
      });
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const removeEpisode = async (episodeId: string, episodeTitle: string) => {
    const ok = await confirm({
      title:
        t("podcastPage.confirmDeleteEpisodeTitle", { defaultValue: "Delete episode?" }) ??
        "Delete episode?",
      body:
        t("podcastPage.confirmDeleteEpisodeBody", {
          title: episodeTitle,
          defaultValue:
            'The episode "{{title}}" plus its audio file and generated cover image will be permanently removed. Any public share link will stop working.',
        }) ?? "",
      confirmLabel: t("common.delete") ?? "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEpisode(detail.id, episodeId);
      const updated = await api.getPlaylist(detail.id);
      onChange(updated);
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
      const result = await api.draftEpisode(
        detail.id,
        targetMinutes,
        draftLanguage || undefined,
      );
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
        cover_style: coverStyle.trim() || undefined,
        cover_text: coverText.trim() || undefined,
      });
      // Backend already cleared the draft on success. Refresh + sync local.
      const updated = await api.getPlaylist(detail.id);
      onChange(updated);
      setDraftTitle("");
      setDraftText("");
      lastSavedRef.current = { title: "", text: "" };
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setProduceBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Description — inline-editable, mirrors PathEditPage's
          "Description" section. Title + delete + counters live in the
          sticky page header above. */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          {t("paths.description", { defaultValue: "Description" })}
        </h2>
        {editingDescription ? (
          <input
            autoFocus
            type="text"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => void saveDescription()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveDescription();
              } else if (e.key === "Escape") {
                setEditingDescription(false);
                setDescDraft(detail.description ?? "");
              }
            }}
            placeholder={t("podcastPage.descriptionPh", { defaultValue: "Description (optional)" }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
          />
        ) : (
          <p
            onClick={() => setEditingDescription(true)}
            className="cursor-text rounded-md border border-dashed border-ink-800 bg-ink-800/30 px-3 py-2 text-sm text-ink-300 transition hover:border-ink-700 hover:text-ink-200"
            title={t("podcastPage.editDescription", { defaultValue: "Click to edit description" }) ?? ""}
          >
            {detail.description || (
              <span className="text-ink-500">
                {t("podcastPage.addDescription", { defaultValue: "+ add description" })}
              </span>
            )}
          </p>
        )}
      </section>

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
                  <Link
                    to={`/cards/${c.card_id}`}
                    title={t("podcastPage.openCard", { defaultValue: "Open card" }) ?? ""}
                    className="rounded p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
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
              <label className="flex items-center gap-2 text-[11px] text-ink-300">
                {t("podcastPage.draftLanguage", { defaultValue: "Language" })}:
                <select
                  value={draftLanguage}
                  onChange={(e) => setDraftLanguage(e.target.value)}
                  className="rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
                >
                  <option value="">{t("podcastPage.langAuto", { defaultValue: "Auto-detect" })}</option>
                  <option value="Deutsch">Deutsch</option>
                  <option value="English">English</option>
                  <option value="Français">Français</option>
                  <option value="Español">Español</option>
                  <option value="Italiano">Italiano</option>
                  <option value="Português">Português</option>
                  <option value="Nederlands">Nederlands</option>
                  <option value="Polski">Polski</option>
                  <option value="日本語">日本語</option>
                  <option value="中文">中文</option>
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
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t("podcastPage.episodeTitle", { defaultValue: "Episode title" }) ?? ""}
                className="flex-1 rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-sm font-medium text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
              />
              <span className="flex items-center gap-1 text-[10px] text-ink-500">
                {draftSaving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("podcastPage.savingDraft", { defaultValue: "Saving…" })}
                  </>
                ) : (
                  t("podcastPage.draftSaved", { defaultValue: "Draft saved" })
                )}
              </span>
            </div>
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
              {generateCover && (
                <div className="flex w-full flex-col gap-2 rounded-md border border-ink-800 bg-ink-900/40 p-2.5">
                  <button
                    type="button"
                    onClick={() => void suggestCover()}
                    disabled={
                      coverSuggestBusy ||
                      !draftTitle.trim() ||
                      draftText.trim().length < 20
                    }
                    className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 transition hover:bg-ink-800 disabled:opacity-50"
                    title={t("podcastPage.suggestCoverTitle", { defaultValue: "Generate style + teaser text from the script" }) ?? ""}
                  >
                    {coverSuggestBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {t("podcastPage.suggestCover", {
                      defaultValue: "Suggest style + cover text",
                    })}
                  </button>
                  <label className="flex flex-col gap-1 text-[10px] text-ink-400">
                    <span>
                      {t("podcastPage.coverStyle", {
                        defaultValue: "Cover style — what should it look like?",
                      })}
                    </span>
                    <input
                      type="text"
                      value={coverStyle}
                      onChange={(e) => setCoverStyle(e.target.value)}
                      placeholder={
                        t("podcastPage.coverStylePh", {
                          defaultValue:
                            "e.g. retro 70s warm tones, blueprint sketch, minimalist Bauhaus…",
                        }) ?? ""
                      }
                      className="rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-ink-400">
                    <span>
                      {t("podcastPage.coverText", {
                        defaultValue: "Cover text — leave empty for none",
                      })}
                    </span>
                    <input
                      type="text"
                      value={coverText}
                      onChange={(e) => setCoverText(e.target.value)}
                      maxLength={80}
                      placeholder={
                        t("podcastPage.coverTextPh", {
                          defaultValue: "e.g. EPISODE 03 · OPEN AI",
                        }) ?? ""
                      }
                      className="rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
                    />
                  </label>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void wipeDraft()}
                  disabled={produceBusy}
                  title={t("podcastPage.discardDraftTitle", { defaultValue: "Discard draft" }) ?? ""}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1.5 text-[11px] text-ink-300 transition hover:bg-ink-800"
                >
                  {t("podcastPage.discardDraft", { defaultValue: "Discard draft" })}
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
            <p className="text-[11px] text-ink-400">
              {t("podcastPage.produceHint", {
                defaultValue:
                  "Production runs in the background — feel free to leave the page; the episode will show up when ready.",
              })}
            </p>
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
                onDelete={() => removeEpisode(e.id, e.title)}
                onRetry={async () => {
                  try {
                    await api.retryEpisode(detail.id, e.id);
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
          onPickMany={async (cardIds) => {
            if (cardIds.length === 0) return;
            try {
              const updated = await api.addPlaylistCardsBulk(detail.id, cardIds);
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
  onRetry,
}: {
  episode: import("../lib/api").PodcastEpisodeOut;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [audioBlob, setAudioBlob] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const audioUrlRef = useRef<string | null>(null);
  const coverUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

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

  const isProcessing = episode.status === "processing";
  const isFailed = episode.status === "failed";

  return (
    <div
      className={[
        "surface-soft flex gap-4 rounded-xl border bg-ink-800/40 p-4 transition",
        isFailed ? "border-red-500/30" : "border-ink-800",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => coverBlob && setLightboxOpen(true)}
        disabled={!coverBlob}
        className="group relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-900 transition disabled:cursor-default"
        title={coverBlob ? t("podcastPage.viewCover", { defaultValue: "View cover" }) ?? "" : ""}
      >
        {coverBlob ? (
          <>
            <img src={coverBlob} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
            <span className="absolute inset-0 bg-ink-900/0 transition group-hover:bg-ink-900/20" />
          </>
        ) : (
          <ImageIcon className="h-6 w-6 text-ink-500" />
        )}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm">
            <Loader2 className="h-5 w-5 animate-spin text-ink-100" />
          </div>
        )}
      </button>
      {shareOpen && (
        <EpisodeShareModal
          episodeId={episode.id}
          episodeTitle={episode.title}
          coverBlob={coverBlob}
          onClose={() => setShareOpen(false)}
        />
      )}
      {lightboxOpen && coverBlob &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/85 backdrop-blur-md modal-backdrop-enter"
            onClick={() => setLightboxOpen(false)}
          >
            <img
              src={coverBlob}
              alt=""
              className="max-h-[88vh] max-w-[88vw] rounded-2xl shadow-2xl modal-card-enter"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute right-6 top-6 rounded-full bg-ink-800/80 p-2 text-ink-100 transition hover:bg-ink-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>,
          document.body,
        )}
      <div className="flex flex-1 min-w-0 flex-col justify-between gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-ink-100">{episode.title}</h4>
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              {episode.voice} · {new Date(episode.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            {episode.status === "ready" && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="rounded p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100"
                title={t("podcastPage.share", { defaultValue: "Share episode" }) ?? ""}
              >
                <Share2 className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1 text-ink-500 transition hover:bg-red-500/10 hover:text-red-300"
              title={t("common.delete") ?? ""}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        {isProcessing ? (
          <div className="space-y-1.5">
            <p className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("podcastPage.episodeProcessing", {
                defaultValue: "Synthesizing audio + cover…",
              })}
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400/70" />
            </div>
          </div>
        ) : isFailed ? (
          <div className="flex items-start justify-between gap-2">
            <p className="flex-1 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
              {episode.error_message ?? t("common.error")}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-200 transition hover:bg-ink-800"
            >
              <RefreshCw className="h-3 w-3" />
              {t("common.retry")}
            </button>
          </div>
        ) : audioBlob ? (
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
  onPickMany,
  onClose,
}: {
  excludeIds: string[];
  onPickMany: (cardIds: string[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CardListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api.listCards({ status: "completed" }).then(setCards);
  }, []);

  const alreadyIn = useMemo(() => new Set(excludeIds), [excludeIds]);
  // Show ALL completed cards. Already-in-playlist ones render disabled
  // with a "in playlist" pill so the user can see them but can't pick.
  const filtered = (cards ?? []).filter(
    (c) =>
      query.trim().length === 0 || c.title.toLowerCase().includes(query.toLowerCase()),
  );

  const toggle = (id: string) => {
    if (alreadyIn.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onPickMany(Array.from(selected));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh]"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 surface-elevated">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">
            {t("podcastPage.pickCards", { defaultValue: "Add cards to the playlist" })}
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
              {t("podcastPage.noMoreCards", { defaultValue: "No cards match." })}
            </p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {filtered.map((c) => {
                const isIn = alreadyIn.has(c.id);
                const isSel = selected.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      disabled={isIn}
                      aria-pressed={isSel}
                      className={[
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition",
                        isIn
                          ? "cursor-not-allowed opacity-50"
                          : isSel
                            ? "bg-emerald-500/10 ring-inset ring-1 ring-emerald-500/40"
                            : "hover:bg-ink-700/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition",
                          isIn
                            ? "border-ink-600 bg-ink-700/40 text-ink-500"
                            : isSel
                              ? "border-emerald-400 bg-emerald-400 text-ink-900"
                              : "border-ink-600 bg-transparent text-transparent",
                        ].join(" ")}
                      >
                        {(isIn || isSel) && <Check className="h-3 w-3" />}
                      </span>
                      {c.thumbnail_url ? (
                        <img
                          src={c.thumbnail_url}
                          alt=""
                          className="h-9 w-14 flex-shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <div className="h-9 w-14 flex-shrink-0 rounded-sm bg-ink-900" />
                      )}
                      <span className="flex-1 truncate text-xs text-ink-200">
                        {c.title}
                      </span>
                      {isIn && (
                        <span className="rounded-full bg-ink-700/70 px-2 py-0.5 text-[10px] text-ink-400 ring-1 ring-ink-600">
                          {t("podcastPage.alreadyIn", { defaultValue: "in playlist" })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-ink-700 bg-ink-900/40 px-4 py-3">
          <span className="text-[11px] text-ink-400">
            {t("podcastPage.selectedCount", {
              defaultValue: "{{count}} selected",
              count: selected.size,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={selected.size === 0 || submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("podcastPage.addSelected", {
                defaultValue: "Add {{count}}",
                count: selected.size,
              })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function EpisodeShareModal({
  episodeId,
  episodeTitle,
  coverBlob,
  onClose,
}: {
  episodeId: string;
  episodeTitle: string;
  coverBlob: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [share, setShare] = useState<EpisodeShareOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .getEpisodeShare(episodeId)
      .then((s) => setShare(s))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [episodeId]);

  const create = async () => {
    setLoading(true);
    try {
      const s = await api.createEpisodeShare(episodeId);
      setShare(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title:
        t("podcastPage.revokeConfirmTitle", { defaultValue: "Revoke the public link?" }) ??
        "Revoke?",
      body:
        t("podcastPage.revokeConfirmBody", {
          defaultValue:
            "Anyone who already has the link will get a 'not found' page. You can create a new link later.",
        }) ?? "",
      confirmLabel: t("podcastPage.revokeShare", { defaultValue: "Revoke link" }) ?? "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeEpisodeShare(episodeId);
      setShare(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = share ? `${origin}${share.public_url}` : "";
  const embedUrl = share ? `${origin}${share.embed_url}` : "";
  const embedSnippet = share
    ? `<iframe src="${embedUrl}" width="480" height="120" style="border:0;border-radius:12px" allow="autoplay" loading="lazy"></iframe>`
    : "";
  const tweetUrl = share
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(episodeTitle)}&url=${encodeURIComponent(publicUrl)}`
    : "";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[65] flex items-start justify-center px-4 pt-[10vh] modal-backdrop-enter"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md"
      />
      <div className="relative flex w-full max-w-lg flex-col gap-4 overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 p-5 surface-elevated modal-card-enter">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {coverBlob && (
              <img
                src={coverBlob}
                alt=""
                className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
              />
            )}
            <div>
              <h3 className="text-sm font-semibold text-ink-100">
                {t("podcastPage.shareTitle", { defaultValue: "Share episode" })}
              </h3>
              <p className="truncate text-[11px] text-ink-400">{episodeTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        {loading ? (
          <p className="text-xs text-ink-400">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {t("common.loading")}
          </p>
        ) : !share ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-300">
              {t("podcastPage.shareIdleHint", {
                defaultValue:
                  "Generate a public link anyone can listen to — no login. You can revoke it at any time.",
              })}
            </p>
            <button
              type="button"
              onClick={create}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200"
            >
              <Link2 className="h-3.5 w-3.5" />
              {t("podcastPage.createShareLink", { defaultValue: "Create public link" })}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <ShareField
              label={t("podcastPage.publicLink", { defaultValue: "Public link" }) ?? "Public link"}
              value={publicUrl}
              onCopy={() => copy(publicUrl, "url")}
              copied={copied === "url"}
            />
            <ShareField
              label={t("podcastPage.embedSnippet", { defaultValue: "Embed snippet" }) ?? "Embed"}
              value={embedSnippet}
              onCopy={() => copy(embedSnippet, "embed")}
              copied={copied === "embed"}
              multiline
            />
            <div className="flex items-center justify-between gap-2 border-t border-ink-700 pt-3">
              <a
                href={tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-700/40"
              >
                {t("podcastPage.tweet", { defaultValue: "Share on X" })}
              </a>
              <button
                type="button"
                onClick={revoke}
                className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
              >
                {t("podcastPage.revokeShare", { defaultValue: "Revoke link" })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ShareField({
  label,
  value,
  onCopy,
  copied,
  multiline = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </label>
      <div className="flex items-stretch gap-1">
        {multiline ? (
          <textarea
            readOnly
            value={value}
            rows={3}
            className="flex-1 rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 font-mono text-[10px] text-ink-200 focus:outline-none"
          />
        ) : (
          <input
            type="text"
            readOnly
            value={value}
            className="flex-1 rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 font-mono text-[10px] text-ink-200 focus:outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <button
          type="button"
          onClick={onCopy}
          className={[
            "inline-flex flex-shrink-0 items-center justify-center rounded-md border px-2 transition",
            copied
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-ink-700 text-ink-300 hover:bg-ink-700/40",
          ].join(" ")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function TagToPlaylistModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (pl: PodcastPlaylistOut) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<{ name: string; count: number }[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [includeSubtags, setIncludeSubtags] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .listTags()
      .then((rows) =>
        setTags(rows.map((r) => ({ name: r.name, count: r.count }))),
      )
      .catch((err) => onError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (tags ?? []).filter((t2) =>
    query.trim().length === 0 ? true : t2.name.toLowerCase().includes(query.toLowerCase()),
  );

  const create = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const pl = await api.createPlaylistFromTag(picked, {
        include_subtags: includeSubtags,
      });
      onCreated(pl);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[65] flex items-start justify-center px-4 pt-[10vh] modal-backdrop-enter"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md"
      />
      <div className="relative flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 surface-elevated modal-card-enter">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">
            {t("podcastPage.fromTagTitle", { defaultValue: "Create playlist from a tag" })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-300 transition hover:bg-ink-700 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="border-b border-ink-700 p-3">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("podcastPage.searchTags", { defaultValue: "Search tags…" }) ?? ""}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {tags === null ? (
            <p className="p-6 text-center text-xs text-ink-500">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              {t("common.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-ink-500">
              {t("podcastPage.noTagsMatch", { defaultValue: "No tags match." })}
            </p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {filtered.map((row) => {
                const isSel = picked === row.name;
                return (
                  <li key={row.name}>
                    <button
                      type="button"
                      onClick={() => setPicked(row.name)}
                      className={[
                        "flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition",
                        isSel
                          ? "bg-emerald-500/10 ring-inset ring-1 ring-emerald-500/40"
                          : "text-ink-200 hover:bg-ink-700/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition",
                          isSel
                            ? "border-emerald-400 bg-emerald-400 text-ink-900"
                            : "border-ink-600 bg-transparent text-transparent",
                        ].join(" ")}
                      >
                        {isSel && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <Hash className="h-3 w-3 text-ink-400" />
                      <span className="flex-1 truncate">{row.name}</span>
                      <span className="text-[10px] tabular-nums text-ink-500">
                        {row.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-ink-700 bg-ink-900/40 px-4 py-3">
          <label className="inline-flex items-center gap-2 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={includeSubtags}
              onChange={(e) => setIncludeSubtags(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("podcastPage.includeSubtags", { defaultValue: "Include sub-tags" })}
          </label>
          <button
            type="button"
            onClick={create}
            disabled={!picked || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("podcastPage.createPlaylist", { defaultValue: "Create playlist" })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
