import { Headphones, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { api, type PublicEpisodeOut } from "../lib/api";

interface Props {
  embed?: boolean;
}

/**
 * Public-facing episode pages:
 *
 *   /share/episode/:token  → standalone player with cover + transcript
 *   /embed/episode/:token  → minimal iframe-friendly mini-player
 *
 * Both fetch via the same unauthenticated endpoint. The embed variant
 * strips the chrome so it sits flat in any host page.
 */
export default function PublicEpisodePage({ embed = false }: Props) {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [episode, setEpisode] = useState<PublicEpisodeOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .publicEpisode(token)
      .then(setEpisode)
      .catch((err) => setError((err as Error).message));
  }, [token]);

  // Set the document title + OG meta tags for crawlers (link previews).
  useEffect(() => {
    if (!episode) return;
    document.title = `${episode.title} · Mindshift Podcast`;
    const upsertMeta = (key: string, value: string) => {
      const sel = `meta[property="${key}"]`;
      let el = document.head.querySelector<HTMLMetaElement>(sel);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", value);
    };
    upsertMeta("og:title", episode.title);
    upsertMeta("og:type", "music.song");
    upsertMeta("og:audio", episode.audio_url);
    if (episode.cover_url) upsertMeta("og:image", episode.cover_url);
    upsertMeta(
      "og:description",
      episode.narrative_text.slice(0, 200).replace(/\s+/g, " "),
    );
    upsertMeta("twitter:card", episode.cover_url ? "summary_large_image" : "summary");
  }, [episode]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900 px-6 text-center text-sm text-ink-300">
        {error}
      </div>
    );
  }

  if (!episode || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900 text-sm text-ink-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (embed) {
    return <EmbedPlayer episode={episode} token={token} />;
  }

  return <FullPage episode={episode} token={token} />;
}

function EmbedPlayer({ episode, token }: { episode: PublicEpisodeOut; token: string }) {
  const audioSrc = api.publicEpisodeAudioUrl(token);
  const coverSrc = episode.cover_url ? api.publicEpisodeCoverUrl(token) : null;
  return (
    <div className="flex min-h-screen items-center bg-transparent p-3">
      <div className="surface-soft flex w-full items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/80 p-3 backdrop-blur">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink-800">
          {coverSrc ? (
            <img src={coverSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <Headphones className="h-5 w-5 text-ink-400" />
          )}
        </div>
        <div className="flex flex-1 min-w-0 flex-col gap-1">
          <p className="truncate text-xs font-semibold text-ink-100">{episode.title}</p>
          <audio controls src={audioSrc} className="w-full" preload="metadata">
            <track kind="captions" />
          </audio>
        </div>
      </div>
    </div>
  );
}

function FullPage({ episode, token }: { episode: PublicEpisodeOut; token: string }) {
  const audioSrc = api.publicEpisodeAudioUrl(token);
  const coverSrc = episode.cover_url ? api.publicEpisodeCoverUrl(token) : null;
  const date = new Date(episode.created_at).toLocaleDateString();
  return (
    <div className="min-h-screen bg-ink-900 px-6 py-12 text-ink-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="text-center">
          <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Mindshift Podcast
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-100">
            {episode.title}
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            {episode.voice} · {date}
          </p>
        </header>

        {coverSrc && (
          <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl shadow-2xl">
            <img src={coverSrc} alt="" className="h-full w-full object-cover" />
          </div>
        )}

        <audio controls src={audioSrc} className="w-full" preload="metadata">
          <track kind="captions" />
        </audio>

        <article className="prose prose-invert max-w-none whitespace-pre-line text-sm leading-relaxed text-ink-200">
          {episode.narrative_text}
        </article>

        <footer className="mt-8 border-t border-ink-800 pt-6 text-center text-[10px] text-ink-500">
          Generated with Mindshift
        </footer>
      </div>
    </div>
  );
}
