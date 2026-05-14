/* Channel detail surface — header + tabs + video list.
 *
 * Rendered by DiscoverPage when ?channel=<id> is in the URL.
 * Shape mirrors the Discover layout: page header band + content scroll
 * area, plus a sub-toolbar for tabs and the unread-actions bar.
 */

import {
  Check,
  ChevronLeft,
  ExternalLink,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  api,
  type ChannelSubscription,
  type ChannelTab,
  type ChannelVideo,
} from "../lib/api";
import { useDialog } from "../lib/DialogContext";

interface Props {
  subscription: ChannelSubscription;
  onBack: () => void;
  /** Called after any mutation that changes parent's view of the
   *  subscription (toggle auto-ingest, unsubscribe, refresh, etc). */
  onMutated: (updated: ChannelSubscription | null) => void;
}

const PAGE_SIZE = 20;

export default function ChannelDetailView({
  subscription,
  onBack,
  onMutated,
}: Props) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [sub, setSub] = useState(subscription);
  const [tab, setTab] = useState<ChannelTab>("latest");
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Re-sync local state if parent gave us a fresh subscription.
  useEffect(() => {
    setSub(subscription);
  }, [subscription.id]);

  // Load videos whenever sub or tab changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOffset(0);
    api
      .getChannelVideos(sub.id, tab, 0, PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setVideos(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sub.id, tab]);

  const loadMore = async () => {
    const next = offset + PAGE_SIZE;
    try {
      const res = await api.getChannelVideos(sub.id, tab, next, PAGE_SIZE);
      setVideos((prev) => [...prev, ...res.items]);
      setOffset(next);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleAutoIngest = async () => {
    const nextMode = sub.ingest_mode === "auto" ? "manual" : "auto";
    if (nextMode === "auto") {
      const ok = await dialog.confirm({
        title: t("discover.channels.autoIngest.enableTitle", {
          defaultValue: "Auto-Ingest aktivieren?",
        }),
        body: t("discover.channels.autoIngest.enableConfirm", {
          defaultValue:
            "Neue Uploads werden ab jetzt automatisch zu Karten. Bestehende ungelesene musst du weiter manuell speichern.",
        }),
        confirmLabel: t("discover.channels.autoIngest.enableCta", {
          defaultValue: "Auto-Ingest einschalten",
        }),
        cancelLabel: t("common.cancel", { defaultValue: "Abbrechen" }),
      });
      if (!ok) return;
    }
    try {
      const updated = await api.patchChannel(sub.id, {
        ingest_mode: nextMode,
      });
      setSub(updated);
      onMutated(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleExcludeShorts = async () => {
    try {
      const updated = await api.patchChannel(sub.id, {
        exclude_shorts: !sub.exclude_shorts,
      });
      setSub(updated);
      onMutated(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const unsubscribe = async () => {
    const ok = await dialog.confirm({
      title: t("discover.channels.unsubscribeTitle", {
        defaultValue: "Channel-Abo entfernen?",
      }),
      body: t("discover.channels.unsubscribeConfirm", {
        defaultValue:
          "Deine gespeicherten Karten aus diesem Channel bleiben in der Library.",
      }),
      confirmLabel: t("discover.channels.unsubscribe", {
        defaultValue: "Abo entfernen",
      }),
      cancelLabel: t("common.cancel", { defaultValue: "Abbrechen" }),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.unsubscribeChannel(sub.id);
      onMutated(null);
      onBack();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshChannel(sub.id);
      // Re-fetch list + the subscription summary.
      const [list, all] = await Promise.all([
        api.getChannelVideos(sub.id, tab, 0, PAGE_SIZE),
        api.listChannels(),
      ]);
      setVideos(list.items);
      setTotal(list.total);
      setOffset(0);
      const fresh = all.find((c) => c.id === sub.id);
      if (fresh) {
        setSub(fresh);
        onMutated(fresh);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const saveOne = async (videoId: string) => {
    try {
      const res = await api.saveChannelVideo(sub.id, videoId);
      setVideos((rows) =>
        rows.map((r) =>
          r.video_id === videoId
            ? {
                ...r,
                saved_card_id: res.card_id,
                read_at: r.read_at ?? new Date().toISOString(),
              }
            : r,
        ),
      );
      // Optimistic unread decrement.
      setSub((s) => ({
        ...s,
        unread_count: Math.max(0, s.unread_count - 1),
      }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveAll = async () => {
    setBulkBusy(true);
    setError(null);
    try {
      const res = await api.saveAllUnread(sub.id);
      // Reload list — backend has flipped read_at + filled saved_card_id.
      const list = await api.getChannelVideos(sub.id, tab, 0, PAGE_SIZE);
      setVideos(list.items);
      setTotal(list.total);
      setOffset(0);
      const all = await api.listChannels();
      const fresh = all.find((c) => c.id === sub.id);
      if (fresh) {
        setSub(fresh);
        onMutated(fresh);
      }
      // Brief toast-style message: piggyback on error slot since we
      // don't have a toast system here.
      setError(
        t("discover.channels.unread.savedQueued", {
          count: res.queued,
          defaultValue: "{{count}} Karten in die Pipeline geschickt.",
        }),
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const markAllRead = async () => {
    try {
      await api.markChannelRead(sub.id);
      setVideos((rows) =>
        rows.map((r) => ({
          ...r,
          read_at: r.read_at ?? new Date().toISOString(),
        })),
      );
      setSub((s) => ({ ...s, unread_count: 0 }));
      onMutated({ ...sub, unread_count: 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const unreadVisible = useMemo(
    () => tab === "latest" && sub.unread_count > 0,
    [tab, sub.unread_count],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-950/40 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            aria-label={t("common.back", { defaultValue: "Zurück" }) ?? ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {sub.thumbnail_url ? (
            <img
              src={sub.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-12 w-12 flex-shrink-0 rounded-full bg-ink-800 object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-base font-semibold text-ink-400">
              {sub.title.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-ink-100">
              {sub.title || sub.channel_id}
            </h1>
            <p className="truncate text-[11px] text-ink-500">
              {[
                sub.handle,
                sub.subscriber_count != null
                  ? `${formatSubs(sub.subscriber_count)} ${t(
                      "discover.channels.subscribers",
                      { defaultValue: "Abos" },
                    )}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {sub.description && (
              <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">
                {sub.description}
              </p>
            )}
          </div>

          {/* Action cluster */}
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleAutoIngest}
              title={t("discover.channels.autoIngest.label", {
                defaultValue: "Auto-Ingest",
              }) ?? ""}
              className={[
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition",
                sub.ingest_mode === "auto"
                  ? "border-violet-500 bg-violet-500/15 text-violet-200"
                  : "border-ink-700 text-ink-400 hover:text-ink-100",
              ].join(" ")}
            >
              <Zap className="h-3 w-3" />
              {t("discover.channels.autoIngest.short", {
                defaultValue: "Auto",
              })}
              <span
                className={[
                  "ml-1 inline-block h-1.5 w-1.5 rounded-full",
                  sub.ingest_mode === "auto" ? "bg-violet-400" : "bg-ink-600",
                ].join(" ")}
              />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((s) => !s)}
              aria-label={t("common.settings", { defaultValue: "Einstellungen" }) ?? ""}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-400 hover:text-ink-100"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label={t("common.refresh", { defaultValue: "Aktualisieren" }) ?? ""}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-400 hover:text-ink-100 disabled:opacity-50"
            >
              <RefreshCw
                className={[
                  "h-3.5 w-3.5",
                  refreshing ? "animate-spin" : "",
                ].join(" ")}
              />
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="mx-auto mt-3 flex max-w-6xl items-center gap-3 rounded-md border border-ink-700 bg-ink-900/80 px-3 py-2 text-xs text-ink-300">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={sub.exclude_shorts}
                onChange={toggleExcludeShorts}
                className="accent-violet-400"
              />
              {t("discover.channels.excludeShorts", {
                defaultValue: "Shorts ausschließen",
              })}
            </label>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={unsubscribe}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
              {t("discover.channels.unsubscribe", {
                defaultValue: "Abo entfernen",
              })}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/40 px-4">
        <div className="mx-auto flex max-w-6xl gap-1">
          <TabButton
            active={tab === "latest"}
            onClick={() => setTab("latest")}
            label={t("discover.channels.tabs.latest", {
              defaultValue: "Neu",
            })}
            badge={sub.unread_count > 0 ? sub.unread_count : undefined}
          />
          <TabButton
            active={tab === "popular"}
            onClick={() => setTab("popular")}
            label={t("discover.channels.tabs.popular", {
              defaultValue: "Beliebt",
            })}
          />
          <TabButton
            active={tab === "saved"}
            onClick={() => setTab("saved")}
            label={t("discover.channels.tabs.saved", {
              defaultValue: "Gespeichert",
            })}
          />
        </div>
      </div>

      {/* Unread action bar */}
      {unreadVisible && (
        <div className="flex-shrink-0 border-b border-ink-800 bg-violet-500/5 px-4 py-2">
          <div className="mx-auto flex max-w-6xl items-center gap-2 text-xs">
            <Radio className="h-3.5 w-3.5 text-violet-300" />
            <span className="text-ink-300">
              {t("discover.channels.unread.count", {
                count: sub.unread_count,
                defaultValue: "{{count}} ungelesen",
              })}
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={saveAll}
              disabled={bulkBusy}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-violet-500 px-3 text-[11px] font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
            >
              {bulkBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {t("discover.channels.unread.saveAll", {
                defaultValue: "Alle speichern",
              })}
            </button>
            <button
              type="button"
              onClick={markAllRead}
              disabled={bulkBusy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-700 px-3 text-[11px] font-medium text-ink-300 hover:text-ink-100 disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              {t("discover.channels.unread.markAllRead", {
                defaultValue: "Alle als gelesen",
              })}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-6xl">
          {error && (
            <p className="mb-3 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-xs text-ink-300">
              {error}
            </p>
          )}

          {loading ? (
            <p className="flex items-center gap-2 py-8 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading", { defaultValue: "Lädt…" })}
            </p>
          ) : videos.length === 0 ? (
            <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/40 px-3 py-10 text-center text-xs text-ink-500">
              {tab === "saved"
                ? t("discover.channels.savedEmpty", {
                    defaultValue:
                      "Du hast aus diesem Channel noch nichts gespeichert.",
                  })
                : t("discover.channels.latestEmpty", {
                    defaultValue:
                      "Keine Videos gefunden. Versuche „Aktualisieren“.",
                  })}
            </p>
          ) : (
            <>
              <ul className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40 divide-y divide-ink-800">
                {videos.map((v) => (
                  <ChannelVideoRow
                    key={v.video_id}
                    video={v}
                    excludeShorts={sub.exclude_shorts}
                    onSave={() => saveOne(v.video_id)}
                  />
                ))}
              </ul>
              {videos.length < total && (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-[12px] font-medium text-ink-900 shadow-sm transition hover:bg-ink-200"
                  >
                    {t("discover.loadMore", { defaultValue: "Mehr laden" })}
                    <span className="text-ink-500">({total - videos.length})</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition",
        active
          ? "border-violet-400 text-ink-100"
          : "border-transparent text-ink-400 hover:text-ink-100",
      ].join(" ")}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[9px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function ChannelVideoRow({
  video,
  excludeShorts,
  onSave,
}: {
  video: ChannelVideo;
  excludeShorts: boolean;
  onSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const isUnread = !video.read_at;
  const isSaved = !!video.saved_card_id;
  const shouldDim = excludeShorts && video.is_short && !isSaved;

  const watchUrl = `https://youtu.be/${video.video_id}`;

  const handleSave = async () => {
    if (saving || isSaved) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={[
        "flex items-center gap-3 px-3 py-2.5",
        shouldDim ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className={[
          "h-1.5 w-1.5 flex-shrink-0 rounded-full",
          isUnread ? "bg-violet-400" : "bg-transparent",
        ].join(" ")}
        aria-hidden
      />
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-12 w-20 flex-shrink-0 rounded bg-ink-800 object-cover"
        />
      ) : (
        <div className="h-12 w-20 flex-shrink-0 rounded bg-ink-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm text-ink-100">{video.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-500">
          {[
            video.is_short
              ? t("discover.channels.shortLabel", {
                  defaultValue: "Short",
                })
              : null,
            video.duration_seconds != null
              ? formatDuration(video.duration_seconds)
              : null,
            video.published_at ? formatRelative(video.published_at) : null,
            video.view_count != null
              ? `${formatViews(video.view_count)} ${t(
                  "discover.channels.views",
                  { defaultValue: "Aufrufe" },
                )}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:text-ink-100"
          aria-label="YouTube"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {isSaved ? (
          <button
            type="button"
            onClick={() =>
              video.saved_card_id &&
              navigate(`/card/${video.saved_card_id}`)
            }
            className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/30 px-2.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10"
          >
            <Check className="h-3 w-3" />
            {t("discover.channels.openSaved", { defaultValue: "Öffnen" })}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-ink-100 px-2.5 text-[11px] font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            {t("common.save", { defaultValue: "Speichern" })}
          </button>
        )}
      </div>
    </li>
  );
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatViews(n: number): string {
  return formatSubs(n);
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}:${String(r).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  const yr = Math.floor(day / 365);
  return `${yr}y`;
}
