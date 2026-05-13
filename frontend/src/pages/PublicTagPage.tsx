import { ArrowLeft, FileText, Github, Globe, Hash, Loader2, Rss, Youtube, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import PublicShell from "../components/PublicShell";
import Reactions from "../components/Reactions";
import { api, type PublicCard, type PublicTagDetail } from "../lib/api";
import { setMetaTags } from "../lib/metaTags";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  note: FileText,
  github: Github,
};

export default function PublicTagPage() {
  const { username = "", "*": rest } = useParams<{ username: string; "*": string }>();
  const slug = rest ?? "";
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tag, setTag] = useState<PublicTagDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<PublicCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPublicTag(username, slug)
      .then((d) => {
        if (!cancelled) {
          setTag(d);
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
  }, [username, slug]);

  // Robots noindex — same default-private stance as the profile page.
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
    if (!tag) return;
    const title = `#${tag.name} — @${username}`;
    const desc = `Public collection #${tag.name} curated by @${username} on Mindshift.`;
    const url = `${window.location.origin}/u/${username}/${slug}`;
    return setMetaTags({
      "og:type": "article",
      "og:title": title,
      "og:description": desc,
      "og:url": url,
      "og:site_name": "Mindshift",
      "twitter:card": "summary",
      "twitter:title": title,
      "twitter:description": desc,
    });
  }, [tag, username, slug]);

  const openCard = async (id: string) => {
    setCardLoading(true);
    try {
      setActiveCard(await api.getPublicProfileCard(username, id));
    } finally {
      setCardLoading(false);
    }
  };

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 page-enter sm:px-8 sm:pt-10">
          <button
            type="button"
            onClick={() => navigate(`/u/${username}`)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
          >
            <ArrowLeft className="h-3 w-3" />
            /u/{username}
          </button>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
              <p className="font-medium">
                {t("share.public.tagMissingTitle", { defaultValue: "Tag not found" })}
              </p>
              <p className="mt-1 text-xs text-red-200/80">{error}</p>
            </div>
          )}

          {tag && (
            <>
              <header className="mb-6 flex items-end justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-ink-100">
                    <Hash className="-mt-1 mr-1 inline h-6 w-6 text-ink-500" />
                    {tag.name}
                  </h1>
                  <p className="mt-1 text-sm text-ink-400">
                    {tag.card_count} {t("library.stats.cards")}
                  </p>
                </div>
                <a
                  href={api.publicTagRssUrl(username, slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300"
                  title={t("share.public.rss", { defaultValue: "Subscribe via RSS" })}
                >
                  <Rss className="h-3.5 w-3.5" />
                  RSS
                </a>
              </header>

              {activeCard ? (
                <section className="rounded-xl border border-ink-800 bg-ink-800/40 px-6 py-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-ink-100">{activeCard.title}</h2>
                    <button
                      type="button"
                      onClick={() => setActiveCard(null)}
                      className="text-xs text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
                    >
                      {t("share.public.backToTag", { defaultValue: "Back to tag" })}
                    </button>
                  </div>
                  <CardDetailBody card={activeCard} />
                  {/* Reactions stay outside the 2-column body so they
                   *  sit clearly under the content, full width. */}
                  <div className="mt-5 border-t border-ink-700/60 pt-4">
                    <Reactions username={username} cardId={activeCard.id} />
                  </div>
                </section>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {tag.cards.map((c) => {
                    const Icon = SOURCE_ICONS[c.source_type] ?? FileText;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void openCard(c.id)}
                        className="card-hover group flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/40 text-left hover:border-ink-600"
                      >
                        <div className="aspect-video w-full overflow-hidden bg-ink-800">
                          {c.thumbnail_url ? (
                            <img
                              src={c.thumbnail_url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Icon className="h-8 w-8 text-ink-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 p-3">
                          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
                            <Icon className="h-3 w-3" />
                            {c.source_type}
                          </span>
                          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-100">
                            {c.title}
                          </h3>
                          {c.concise_summary_md && (
                            <p className="line-clamp-3 text-xs text-ink-400">
                              {c.concise_summary_md}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {cardLoading && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-ink-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("common.loading")}
                </p>
              )}

              <Link
                to={`/u/${username}`}
                className="mt-10 block text-center text-[11px] text-ink-500 underline-offset-2 hover:text-ink-200 hover:underline"
              >
                {t("share.public.poweredBy", { defaultValue: "Hosted on Mindshift" })}
              </Link>
            </>
          )}
        </div>
    </PublicShell>
  );
}

/** Detail body for a single open card on the public tag page.
 *
 *  Two-column on md+: sticky video on the left, scrolling text on the
 *  right (TL;DR → key takeaways → detailed summary). All text fields
 *  flow through MarkdownView with the YouTube props so `[t=NN]`
 *  markers come out as clickable pills that scrub the iframe via
 *  `?t=…` (read by CardMedia). */
function CardDetailBody({ card }: { card: PublicCard }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const videoId =
    card.source_type === "youtube" ? card.external_id ?? null : null;
  const sourceUrl = card.source_url ?? null;
  const handleTimestampClick = useCallback(
    (seconds: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("t", String(seconds));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const onTimestampClick = videoId ? handleTimestampClick : undefined;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="md:sticky md:top-4 md:self-start">
        <CardMedia card={card} />
      </div>
      <div className="space-y-4">
        {card.concise_summary_md && (
          <MarkdownView
            source={card.concise_summary_md}
            youtubeVideoId={videoId}
            youtubeUrl={sourceUrl}
            onTimestampClick={onTimestampClick}
            className="text-base text-ink-200"
          />
        )}
        {Array.isArray(card.key_takeaways_json) && card.key_takeaways_json.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {card.key_takeaways_json.map((item, i) => {
              const text =
                typeof item === "string" ? item : (item as { text?: string })?.text;
              if (!text) return null;
              return (
                <li
                  key={i}
                  className="rounded-md border border-ink-700 bg-ink-900/40 p-3 text-sm text-ink-200"
                >
                  <MarkdownView
                    source={text}
                    youtubeVideoId={videoId}
                    youtubeUrl={sourceUrl}
                    onTimestampClick={onTimestampClick}
                    className="!text-ink-200"
                  />
                </li>
              );
            })}
          </ul>
        )}
        {card.detailed_summary_md && (
          <MarkdownView
            source={card.detailed_summary_md}
            youtubeVideoId={videoId}
            youtubeUrl={sourceUrl}
            onTimestampClick={onTimestampClick}
          />
        )}
      </div>
    </div>
  );
}

function CardMedia({ card }: { card: PublicCard }) {
  const [searchParams] = useSearchParams();
  // YouTube → embed iframe (so the visitor can actually watch).
  if (card.source_type === "youtube" && card.external_id) {
    const tParam = searchParams.get("t");
    const startSec = tParam ? Math.max(0, Math.floor(Number(tParam) || 0)) : null;
    const src = startSec
      ? `https://www.youtube.com/embed/${card.external_id}?start=${startSec}&autoplay=1`
      : `https://www.youtube.com/embed/${card.external_id}`;
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg ring-1 ring-ink-700">
        <iframe
          key={startSec ?? "no-t"}
          src={src}
          title={card.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  // Article / PDF / others with a known source URL → thumbnail wrapped
  // in a link that opens the original in a new tab.
  if (card.thumbnail_url && card.source_url) {
    return (
      <a
        href={card.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="group mb-4 block overflow-hidden rounded-lg ring-1 ring-ink-700 transition hover:ring-ink-500"
        title={card.source_url}
      >
        <img
          src={card.thumbnail_url}
          alt=""
          className="aspect-video w-full object-cover transition group-hover:opacity-80"
        />
      </a>
    );
  }
  // Fallback: flat thumbnail.
  if (card.thumbnail_url) {
    return (
      <img
        src={card.thumbnail_url}
        alt=""
        className="mb-4 aspect-video w-full rounded-lg object-cover"
      />
    );
  }
  return null;
}
