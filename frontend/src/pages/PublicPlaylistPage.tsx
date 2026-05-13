import { ArrowLeft, Brain, Headphones, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import RailFooterButtons from "../components/RailFooterButtons";
import { api, type PublicPlaylistDetail } from "../lib/api";
import { setMetaTags } from "../lib/metaTags";

/**
 * Public read-only view of a podcast playlist. Lists every episode that
 * is `ready` with an inline audio player. Lives at:
 *
 *   /u/<username>/podcasts/<playlist-id>
 *
 * Reachable only when the playlist owner has both `public_profile=true`
 * and the playlist's `is_public=true`. The audio + cover URLs returned
 * by the API are already public — no extra auth header needed.
 */
export default function PublicPlaylistPage() {
  const { username = "", playlistId = "" } = useParams<{
    username: string;
    playlistId: string;
  }>();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PublicPlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPublicPlaylist(username, playlistId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
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
  }, [username, playlistId]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!detail) return;
    const title = `${detail.name} · @${detail.author_username}`;
    const desc = detail.description ?? `Podcast playlist by @${detail.author_username} on Mindshift.`;
    const firstCover = detail.episodes.find((e) => e.cover_url)?.cover_url ?? null;
    const image = firstCover ? `${window.location.origin}${firstCover}` : undefined;
    return setMetaTags({
      "og:type": "music.playlist",
      "og:title": title,
      "og:description": desc,
      "og:url": `${window.location.origin}/u/${detail.author_username}/podcasts/${detail.id}`,
      "og:site_name": "Mindshift",
      "og:image": image,
      "twitter:card": image ? "summary_large_image" : "summary",
      "twitter:title": title,
      "twitter:description": desc,
      "twitter:image": image,
    });
  }, [detail]);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <header className="border-b border-ink-800 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-ink-100" />
            <span className="text-sm font-semibold text-ink-100">Mindshift</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to={`/u/${username}`}
              className="inline-flex items-center gap-1 truncate text-[11px] text-ink-400 hover:text-ink-100"
            >
              <ArrowLeft className="h-3 w-3" />@{username}
            </Link>
            <RailFooterButtons orientation="row" showSettings={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 page-enter sm:pt-10">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </p>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
            <p className="font-medium">
              {t("share.public.playlistMissingTitle", {
                defaultValue: "Playlist not found",
              })}
            </p>
            <p className="mt-1 text-xs text-red-200/80">{error}</p>
          </div>
        )}

        {detail && (
          <>
            <section className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
                {detail.name}
              </h1>
              {detail.description && (
                <p className="mt-2 text-sm leading-relaxed text-ink-300">
                  {detail.description}
                </p>
              )}
              <p className="mt-2 text-[11px] text-ink-500">
                {detail.episodes.length}{" "}
                {t("podcastPage.episodes", {
                  count: detail.episodes.length,
                  defaultValue: "episodes",
                })}
              </p>
            </section>

            {detail.episodes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center text-sm text-ink-400">
                {t("share.public.noEpisodes", {
                  defaultValue: "This playlist has no published episodes yet.",
                })}
              </p>
            ) : (
              <ul className="cards-stagger space-y-4">
                {detail.episodes.map((ep) => (
                  <li
                    key={ep.id}
                    className="rounded-xl border border-ink-800 bg-ink-800/40 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      {ep.cover_url ? (
                        <img
                          src={ep.cover_url}
                          alt=""
                          className="h-32 w-32 flex-shrink-0 rounded-lg object-cover ring-1 ring-ink-700 sm:h-24 sm:w-24"
                        />
                      ) : (
                        <div className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-sky-500/10 ring-1 ring-sky-500/30 sm:h-24 sm:w-24">
                          <Headphones className="h-8 w-8 text-sky-300" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-100">{ep.title}</p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {ep.voice} · {new Date(ep.created_at).toLocaleDateString()}
                        </p>
                        <audio
                          controls
                          preload="metadata"
                          src={ep.audio_url}
                          className="mt-3 w-full"
                        >
                          <track kind="captions" />
                        </audio>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-10 text-center text-[11px] text-ink-500">
              <Link to={`/u/${username}`} className="hover:text-ink-200">
                {t("share.public.poweredBy", { defaultValue: "Hosted on Mindshift" })}
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
