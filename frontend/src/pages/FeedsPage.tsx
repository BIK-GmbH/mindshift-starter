import { CheckCircle2, Loader2, Plus, RefreshCw, Rss, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import PageHeader from "../components/PageHeader";
import { api, type FeedOut } from "../lib/api";
import { useDialog } from "../lib/DialogContext";

interface ToastState {
  kind: "ok" | "err";
  text: string;
}

/**
 * Feeds page — lists every RSS/Atom subscription, lets the user add new
 * ones, refresh on demand, rename, toggle active, or remove. Newly added
 * feeds are polled immediately on the server side, so the user sees
 * cards appear in the library within seconds.
 */
export default function FeedsPage() {
  const { t } = useTranslation();
  const [feeds, setFeeds] = useState<FeedOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Auto-dismiss the toast after 5 s so a stale "3 new items" banner
  // from a refresh five minutes ago doesn't sit on the page forever.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const fetchFeeds = useCallback(async () => {
    try {
      const list = await api.listFeeds();
      setFeeds(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeeds();
  }, [fetchFeeds]);

  const addFeed = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      const created = await api.createFeed(url);
      setFeeds((prev) => [created, ...prev]);
      setNewUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const refreshAll = async () => {
    setRefreshingAll(true);
    setError(null);
    try {
      const result = await api.refreshAllFeeds();
      // Re-list so the per-row "last sync" + counts update.
      await fetchFeeds();
      const errorCount = Object.keys(result.per_feed_errors || {}).length;
      if (result.queued > 0) {
        setToast({
          kind: "ok",
          text: t("feeds.toast.allDoneWithItems", {
            defaultValue:
              "Refreshed {{feeds}} feeds — {{queued}} new, {{skipped}} already saved.",
            feeds: result.feeds_polled,
            queued: result.queued,
            skipped: result.skipped_seen,
          }),
        });
      } else {
        setToast({
          kind: "ok",
          text: t("feeds.toast.allDoneNothingNew", {
            defaultValue: "Refreshed {{feeds}} feeds — nothing new.",
            feeds: result.feeds_polled,
          }),
        });
      }
      if (errorCount > 0) {
        setError(
          t("feeds.toast.someFailed", {
            defaultValue: "{{count}} feed(s) failed — see inline errors.",
            count: errorCount,
          }) ?? "",
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Rss}
        tone="orange"
        title={t("feeds.title", { defaultValue: "Feeds" })}
        subtitle={t("feeds.subtitle", {
          defaultValue:
            "Subscribe to RSS / Atom feeds — new posts get auto-summarised into cards.",
        })}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-6">
          {/* Refresh-result toast (per-feed and refresh-all share it) */}
          {toast && (
            <div
              className={[
                "mb-4 rounded-md border px-3 py-2 text-xs",
                toast.kind === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200",
              ].join(" ")}
              role="status"
            >
              {toast.text}
            </div>
          )}

          {/* Add a new feed */}
          <section className="mb-6 rounded-xl border border-ink-800 bg-ink-800/30 p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
              {t("feeds.add.heading", { defaultValue: "Add a feed" })}
            </h2>
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFeed();
                }}
                placeholder={t("feeds.add.placeholder", {
                  defaultValue: "https://example.com/feed.xml",
                })}
                className="flex-1 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void addFeed()}
                disabled={adding || !newUrl.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
              >
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {t("feeds.add.button", { defaultValue: "Subscribe" })}
              </button>
            </div>
            {error && (
              <p className="mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">{error}</p>
            )}
          </section>

          {/* List */}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </div>
          ) : feeds.length === 0 ? (
            <p className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 px-4 py-8 text-center text-xs text-ink-400">
              {t("feeds.empty", {
                defaultValue: "No subscriptions yet — paste an RSS or Atom URL above to start.",
              })}
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-ink-500">
                  {t("feeds.subscriptions", { defaultValue: "Subscriptions" })}
                  <span className="ml-1.5 text-ink-400">({feeds.length})</span>
                </p>
                <button
                  type="button"
                  onClick={() => void refreshAll()}
                  disabled={refreshingAll}
                  className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-200 transition hover:bg-orange-500/20 disabled:opacity-50"
                >
                  <RefreshCw
                    className={["h-3 w-3", refreshingAll ? "animate-spin" : ""].join(" ")}
                  />
                  {t("feeds.refreshAll", { defaultValue: "Refresh all" })}
                </button>
              </div>
              <ul className="space-y-2">
                {feeds.map((feed) => (
                  <FeedRow
                    key={feed.id}
                    feed={feed}
                    onChanged={(next) =>
                      setFeeds((prev) => prev.map((f) => (f.id === next.id ? next : f)))
                    }
                    onDeleted={() => setFeeds((prev) => prev.filter((f) => f.id !== feed.id))}
                    onError={setError}
                    onToast={setToast}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface FeedRowProps {
  feed: FeedOut;
  onChanged: (next: FeedOut) => void;
  onDeleted: () => void;
  onError: (msg: string | null) => void;
  onToast: (t: ToastState | null) => void;
}

function FeedRow({ feed, onChanged, onDeleted, onError, onToast }: FeedRowProps) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [refreshing, setRefreshing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(feed.title);

  const refresh = async () => {
    setRefreshing(true);
    onError(null);
    try {
      const result = await api.refreshFeed(feed.id);
      // Re-fetch the feed row so the success timestamp + counts are
      // current — refreshFeed only returns the poll summary.
      const all = await api.listFeeds();
      const next = all.find((f) => f.id === feed.id);
      if (next) onChanged(next);
      if (result.error) {
        onError(result.error);
      } else if (result.queued > 0) {
        onToast({
          kind: "ok",
          text: t("feeds.toast.oneDoneWithItems", {
            defaultValue: "{{queued}} new, {{skipped}} already saved.",
            queued: result.queued,
            skipped: result.skipped_seen,
          }),
        });
      } else {
        onToast({
          kind: "ok",
          text: t("feeds.toast.oneDoneNothingNew", {
            defaultValue: "No new items in this feed.",
          }),
        });
      }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("feeds.confirmDeleteTitle", { defaultValue: "Feed entfernen?" }),
      body: t("feeds.confirmDelete", {
        defaultValue:
          "Das Abo wird entfernt. Bereits gespeicherte Karten aus diesem Feed bleiben in der Library.",
      }),
      confirmLabel: t("common.delete", { defaultValue: "Entfernen" }),
      cancelLabel: t("common.cancel", { defaultValue: "Abbrechen" }),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFeed(feed.id);
      onDeleted();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const toggleActive = async () => {
    try {
      const next = await api.updateFeed(feed.id, { is_active: !feed.is_active });
      onChanged(next);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleDraft === feed.title) return;
    try {
      const next = await api.updateFeed(feed.id, { title: titleDraft });
      onChanged(next);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const displayTitle = feed.title || feed.feed_url;
  const lastSync = feed.last_success_at
    ? new Date(feed.last_success_at).toLocaleString()
    : t("feeds.neverSynced", { defaultValue: "never synced" });

  return (
    <li
      className={[
        "rounded-xl border bg-ink-800/30 p-3 transition",
        feed.is_active ? "border-ink-800" : "border-ink-800/50 opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500/10 ring-1 ring-orange-500/20">
          <Rss className="h-3.5 w-3.5 text-orange-300" />
        </div>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") {
                  setTitleDraft(feed.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(feed.title);
                setEditingTitle(true);
              }}
              title={t("feeds.editTitle", { defaultValue: "Click to rename" }) ?? ""}
              className="block max-w-full truncate text-left text-sm font-medium text-ink-100 transition hover:text-orange-300"
            >
              {displayTitle}
            </button>
          )}
          <a
            href={feed.feed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-full truncate font-mono text-[10px] text-ink-500 hover:text-ink-300"
          >
            {feed.feed_url}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-400">
            <span className="inline-flex items-center gap-1">
              {feed.last_error ? (
                <XCircle className="h-3 w-3 text-red-400" />
              ) : feed.last_success_at ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              ) : (
                <Loader2 className="h-3 w-3 text-ink-500" />
              )}
              {lastSync}
            </span>
            <span className="text-ink-600">·</span>
            <span>
              {feed.items_ingested} {t("feeds.ingested", { defaultValue: "items" })}
            </span>
            {feed.last_error && (
              <span className="block w-full truncate text-red-300" title={feed.last_error}>
                {feed.last_error}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            title={t("feeds.refresh", { defaultValue: "Refresh" }) ?? ""}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/10 px-2 text-[11px] font-medium text-orange-200 transition hover:bg-orange-500/20 disabled:opacity-50"
          >
            <RefreshCw className={["h-3 w-3", refreshing ? "animate-spin" : ""].join(" ")} />
            <span className="hidden sm:inline">
              {t("feeds.refresh", { defaultValue: "Refresh" })}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void toggleActive()}
            title={
              feed.is_active
                ? t("feeds.pause", { defaultValue: "Pause polling" }) ?? ""
                : t("feeds.resume", { defaultValue: "Resume polling" }) ?? ""
            }
            className={[
              "flex h-7 px-2 items-center justify-center rounded-md border text-[10px] uppercase tracking-wider transition",
              feed.is_active
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-ink-700 text-ink-400 hover:bg-ink-800",
            ].join(" ")}
          >
            {feed.is_active
              ? t("feeds.active", { defaultValue: "Active" })
              : t("feeds.paused", { defaultValue: "Paused" })}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            title={t("common.delete") ?? ""}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-400 transition hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </li>
  );
}
