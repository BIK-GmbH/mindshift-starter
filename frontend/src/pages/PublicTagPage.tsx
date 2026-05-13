import { ArrowLeft, ChevronDown, ChevronRight, FileText, Github, Globe, Hash, Loader2, Rss, Search, X, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PublicCardInlineView } from "../components/PublicCardInlineView";
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
  // Subtag chip row is collapsed when there are many — 92 chips on the
  // /ai page made the actual cards disappear below the fold.
  const [subtagsOpen, setSubtagsOpen] = useState(false);
  // Client-side filter across cards in this tag + its sub-tag chips.
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!tag) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return { cards: tag.cards, subtags: tag.subtags ?? [] };
    return {
      cards: tag.cards.filter(
        (c) =>
          c.title.toLowerCase().includes(needle) ||
          (c.concise_summary_md ?? "").toLowerCase().includes(needle),
      ),
      subtags: (tag.subtags ?? []).filter((s) =>
        s.name.toLowerCase().includes(needle),
      ),
    };
  }, [tag, query]);

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
                <div className="min-w-0">
                  {tag.name_path && tag.name_path.length > 1 && (
                    <nav className="mb-1 flex flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-ink-500">
                      {tag.name_path.slice(0, -1).map((segment, i) => {
                        const partial = tag.name_path.slice(0, i + 1).join("/");
                        return (
                          <span key={i} className="flex items-center gap-1">
                            <Link
                              to={`/u/${username}/${encodeURI(partial)}`}
                              className="transition hover:text-ink-200"
                            >
                              {segment}
                            </Link>
                            <ChevronRight className="h-3 w-3 text-ink-600" />
                          </span>
                        );
                      })}
                    </nav>
                  )}
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

              {!activeCard && tag.cards.length > 0 && (
                <div className="mb-5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("share.public.searchInTag", {
                        defaultValue: "Search in this collection…",
                      })}
                      className="w-full rounded-xl border border-ink-700 bg-ink-800/40 py-2.5 pl-9 pr-9 text-sm text-ink-100 placeholder-ink-500 transition focus:border-ink-500 focus:bg-ink-800/70 focus:outline-none"
                      aria-label={t("share.public.searchInTag", {
                        defaultValue: "Search in this collection…",
                      })}
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label={t("common.clear", { defaultValue: "Clear" })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {filtered && filtered.subtags.length > 0 && !activeCard && (() => {
                // Few enough to show inline — no accordion needed.
                const ALWAYS_OPEN_THRESHOLD = 8;
                const subtagsForRender = filtered.subtags;
                const alwaysOpen = subtagsForRender.length <= ALWAYS_OPEN_THRESHOLD;
                const isOpen = alwaysOpen || subtagsOpen;
                return (
                  <div className="mb-5">
                    {!alwaysOpen && (
                      <button
                        type="button"
                        onClick={() => setSubtagsOpen((v) => !v)}
                        aria-expanded={isOpen}
                        className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-1.5 text-xs text-ink-200 transition hover:border-ink-500 hover:bg-ink-800/70"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-ink-400 transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`}
                        />
                        {isOpen
                          ? t("share.public.hideSubtags", {
                              count: subtagsForRender.length,
                              defaultValue: "Hide {{count}} sub-tags",
                            })
                          : t("share.public.showSubtags", {
                              count: subtagsForRender.length,
                              defaultValue: "Show {{count}} sub-tags",
                            })}
                      </button>
                    )}
                    {/* CSS Grid trick for animating to/from height:auto.
                        grid-template-rows transitions cleanly between
                        0fr and 1fr; the inner div uses overflow:hidden
                        so chips clip neatly during the slide. */}
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                      style={{
                        gridTemplateRows: isOpen ? "1fr" : "0fr",
                        opacity: isOpen ? 1 : 0,
                      }}
                      aria-hidden={!isOpen}
                    >
                      <div className="overflow-hidden">
                        <div className="flex flex-wrap gap-2 pt-1">
                          {subtagsForRender.map((st) => (
                            <Link
                              key={st.slug}
                              to={`/u/${username}/${encodeURI(st.slug)}`}
                              tabIndex={isOpen ? 0 : -1}
                              className="card-hover inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-800/40 px-3 py-1 text-xs text-ink-200 transition hover:border-ink-500 hover:bg-ink-800/70"
                            >
                              <Hash className="h-3 w-3 text-ink-500" />
                              <span className="font-medium">{st.name}</span>
                              <span className="text-[10px] text-ink-500">{st.card_count}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                  <PublicCardInlineView card={activeCard} />
                  {/* Reactions stay outside the 2-column body so they
                   *  sit clearly under the content, full width. */}
                  <div className="mt-5 border-t border-ink-700/60 pt-4">
                    <Reactions username={username} cardId={activeCard.id} />
                  </div>
                </section>
              ) : filtered && filtered.cards.length === 0 && query.trim() ? (
                <p className="rounded-lg border border-dashed border-ink-700 px-4 py-12 text-center text-sm text-ink-400">
                  {t("share.public.noCardHits", {
                    defaultValue: "No cards match this search.",
                  })}
                </p>
              ) : (
                <div className="cards-stagger grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filtered!.cards.map((c) => {
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

