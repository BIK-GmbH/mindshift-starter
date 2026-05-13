import { ChevronRight, FileText, Github, Globe, Hash, Headphones, Loader2, Search, Sparkles, X, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { PublicCardInlineView } from "../components/PublicCardInlineView";
import PublicShell from "../components/PublicShell";
import Reactions from "../components/Reactions";
import { api, type PublicCard, type PublicCardSummary, type PublicProfileOut } from "../lib/api";
import { setMetaTags } from "../lib/metaTags";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  note: FileText,
  github: Github,
};

/**
 * YouTube-channel-style public profile. Shows the user's avatar + bio
 * up top, then their public tags as cards. Each tag links to a tag
 * page with the cards underneath.
 */
export default function PublicProfilePage() {
  const { username = "" } = useParams<{ username: string }>();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfileOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Profile-wide search. The query filters playlists/paths/tags client-
  // side and triggers a backend search across the user's public cards.
  // 2-char minimum mirrors the backend's empty-result short-circuit.
  const [query, setQuery] = useState("");
  const [cardHits, setCardHits] = useState<PublicCardSummary[] | null>(null);
  const [cardHitsLoading, setCardHitsLoading] = useState(false);
  const [activeCard, setActiveCard] = useState<PublicCard | null>(null);
  const [activeCardLoading, setActiveCardLoading] = useState(false);

  const openCard = async (id: string) => {
    setActiveCardLoading(true);
    try {
      setActiveCard(await api.getPublicProfileCard(username, id));
    } finally {
      setActiveCardLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPublicProfile(username)
      .then((p) => {
        if (!cancelled) {
          setProfile(p);
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
  }, [username]);

  // Debounced backend search across public cards. Fires only for queries
  // >= 2 chars; shorter inputs clear results without hitting the API.
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setCardHits(null);
      setCardHitsLoading(false);
      return;
    }
    let cancelled = false;
    setCardHitsLoading(true);
    const handle = window.setTimeout(() => {
      api
        .searchPublicProfile(username, needle)
        .then((res) => {
          if (!cancelled) setCardHits(res.cards);
        })
        .catch(() => {
          if (!cancelled) setCardHits([]);
        })
        .finally(() => {
          if (!cancelled) setCardHitsLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, username]);

  // Client-side filter for the three tile sections — pure substring
  // match against the visible label (name / title / path segments).
  const filtered = useMemo(() => {
    if (!profile) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return {
        playlists: profile.playlists,
        paths: profile.paths,
        tags: profile.tags,
      };
    }
    return {
      playlists: profile.playlists.filter(
        (pl) =>
          pl.name.toLowerCase().includes(needle) ||
          (pl.description ?? "").toLowerCase().includes(needle),
      ),
      paths: profile.paths.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          (p.description_md ?? "").toLowerCase().includes(needle),
      ),
      tags: profile.tags.filter((tag) => {
        const haystack = [tag.name, tag.slug, ...(tag.name_path ?? [])]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      }),
    };
  }, [profile, query]);

  // Discourage indexing — opt-in later if profile owner wants SEO.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // Mirror OG/Twitter tags so JS-aware bots (Slack, modern Google) get
  // a preview even without the server-side OG endpoint in play.
  useEffect(() => {
    if (!profile) return;
    const title = profile.display_name || profile.username;
    const desc = profile.bio || `@${profile.username}'s public knowledge base on Mindshift.`;
    const image = profile.avatar_file_id
      ? `${window.location.origin}${api.publicAvatarUrl(profile.avatar_file_id).replace(window.location.origin, "")}`
      : null;
    const url = `${window.location.origin}/u/${profile.username}`;
    return setMetaTags({
      "og:type": "profile",
      "og:title": title,
      "og:description": desc,
      "og:url": url,
      "og:site_name": "Mindshift",
      "og:image": image ?? undefined,
      "twitter:card": image ? "summary_large_image" : "summary",
      "twitter:title": title,
      "twitter:description": desc,
      "twitter:image": image ?? undefined,
    });
  }, [profile]);

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 page-enter sm:px-8 sm:pt-12">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
              <p className="font-medium">
                {t("share.public.profileMissingTitle", { defaultValue: "Profile not found" })}
              </p>
              <p className="mt-1 text-xs text-red-200/80">{error}</p>
            </div>
          )}

          {profile && (
            <>
              <header className="mb-8 flex flex-col items-center gap-3 text-center sm:mb-10 sm:flex-row sm:items-center sm:gap-4 sm:text-left">
                {profile.avatar_file_id ? (
                  <img
                    src={api.publicAvatarUrl(profile.avatar_file_id)}
                    alt=""
                    className="h-16 w-16 flex-shrink-0 rounded-full object-cover ring-2 ring-ink-700 sm:h-20 sm:w-20"
                  />
                ) : (
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 text-2xl font-bold text-ink-900 sm:h-20 sm:w-20">
                    {(profile.display_name || profile.username || "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold text-ink-100 sm:text-2xl">
                    {profile.display_name || profile.username}
                  </h1>
                  <p className="text-sm text-ink-400">@{profile.username}</p>
                  {profile.bio && (
                    <p className="mt-2 text-sm leading-relaxed text-ink-300">{profile.bio}</p>
                  )}
                </div>
              </header>

              {activeCard && (
                <section className="mb-6 rounded-xl border border-ink-800 bg-ink-800/40 px-5 py-5 sm:px-6">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="truncate text-xl font-semibold text-ink-100">
                      {activeCard.title}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveCard(null)}
                      className="flex-shrink-0 text-xs text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
                    >
                      {t("share.public.backToProfile", {
                        defaultValue: "Back to profile",
                      })}
                    </button>
                  </div>
                  <PublicCardInlineView card={activeCard} />
                  <div className="mt-5 border-t border-ink-700/60 pt-4">
                    <Reactions username={profile.username} cardId={activeCard.id} />
                  </div>
                </section>
              )}

              {activeCardLoading && !activeCard && (
                <p className="mb-4 inline-flex items-center gap-1 text-xs text-ink-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("common.loading")}
                </p>
              )}

              {/* Search bar — filters tile sections client-side and
                  triggers a backend card search for queries >= 2 chars. */}
              {(profile.tags.length > 0 ||
                profile.paths.length > 0 ||
                profile.playlists.length > 0) && (
                <div className="mb-8">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("share.public.searchPlaceholder", {
                        defaultValue: "Search this profile…",
                      })}
                      className="w-full rounded-xl border border-ink-700 bg-ink-800/40 py-2.5 pl-9 pr-9 text-sm text-ink-100 placeholder-ink-500 transition focus:border-ink-500 focus:bg-ink-800/70 focus:outline-none"
                      aria-label={t("share.public.searchPlaceholder", {
                        defaultValue: "Search this profile…",
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

              {/* Card hits — backend full-text search. Only renders for
                  active queries; loading state stays inline so the rest
                  of the page doesn't flash. */}
              {query.trim().length >= 2 && (
                <section className="mb-8">
                  <h2 className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                    {t("share.public.cardHits", { defaultValue: "Cards" })}
                    {cardHitsLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-ink-500" />
                    )}
                  </h2>
                  {cardHits && cardHits.length === 0 && !cardHitsLoading && (
                    <p className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-xs text-ink-500">
                      {t("share.public.noCardHits", {
                        defaultValue: "No cards match this search.",
                      })}
                    </p>
                  )}
                  {cardHits && cardHits.length > 0 && (
                    <div className="cards-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {cardHits.map((c) => (
                        <CardHitTile
                          key={c.id}
                          card={c}
                          onOpen={() => {
                            void openCard(c.id);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {filtered && filtered.playlists.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                    {t("podcastPage.playlists", { defaultValue: "Podcast playlists" })}
                  </h2>
                  <div className="cards-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.playlists.map((pl) => (
                      <Link
                        key={pl.id}
                        to={`/u/${profile.username}/podcasts/${pl.id}`}
                        className="card-hover group flex gap-3 rounded-xl border border-ink-800 bg-ink-800/40 p-3 transition hover:border-sky-500/40"
                      >
                        {pl.cover_url ? (
                          <img
                            src={pl.cover_url}
                            alt=""
                            className="h-16 w-16 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
                          />
                        ) : (
                          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-sky-500/10 ring-1 ring-sky-500/30">
                            <Headphones className="h-5 w-5 text-sky-300" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-100 group-hover:text-ink-50">
                            {pl.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-400">
                            {pl.episode_count}{" "}
                            {t("podcastPage.episodes", {
                              count: pl.episode_count,
                              defaultValue: "episodes",
                            })}
                            {" · "}
                            {pl.card_count}{" "}
                            {t("podcastPage.cards", {
                              count: pl.card_count,
                              defaultValue: "cards",
                            })}
                          </p>
                          {pl.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-ink-300">{pl.description}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {filtered && filtered.paths.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                    {t("paths.title", { defaultValue: "Paths" })}
                  </h2>
                  <div className="cards-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.paths.map((p) => (
                      <Link
                        key={p.id}
                        to={`/u/${profile.username}/path/${p.slug}`}
                        className="card-hover group flex gap-3 rounded-xl border border-ink-800 bg-ink-800/40 p-3 transition hover:border-ink-600"
                      >
                        {p.cover_url ? (
                          <img
                            src={p.cover_url}
                            alt=""
                            className="h-16 w-16 flex-shrink-0 rounded-md object-cover ring-1 ring-ink-700"
                          />
                        ) : (
                          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 ring-1 ring-fuchsia-500/30">
                            <Sparkles className="h-5 w-5 text-fuchsia-300" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-100 group-hover:text-ink-50">
                            {p.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-400">
                            {p.card_count}{" "}
                            {p.card_count === 1
                              ? t("paths.cardSingular", { defaultValue: "card" })
                              : t("paths.cardPlural", { defaultValue: "cards" })}
                          </p>
                          {p.description_md && (
                            <p className="mt-1 line-clamp-2 text-xs text-ink-300">
                              {p.description_md}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  {t("share.public.publicTags", { defaultValue: "Public collections" })}
                </h2>

                {profile.tags.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-ink-700 px-6 py-12 text-center text-sm text-ink-400">
                    {t("share.public.noTags", {
                      defaultValue: "This profile has no public collections yet.",
                    })}
                  </p>
                ) : filtered && filtered.tags.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-ink-700 px-6 py-12 text-center text-sm text-ink-400">
                    {t("share.public.noTagHits", {
                      defaultValue: "No collections match this search.",
                    })}
                  </p>
                ) : (
                  <div className="cards-stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {filtered!.tags.map((tag) => {
                      const path = tag.name_path?.length ? tag.name_path : [tag.name];
                      const isNested = path.length > 1;
                      return (
                        <Link
                          key={tag.slug}
                          to={`/u/${profile.username}/${encodeURI(tag.slug)}`}
                          className="card-hover group flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-800/40 px-5 py-4 transition hover:border-ink-600"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 truncate text-base font-semibold text-ink-100">
                              <Hash className="h-4 w-4 flex-shrink-0 text-ink-500" />
                              {isNested ? (
                                <span className="flex min-w-0 items-center gap-1">
                                  {path.slice(0, -1).map((segment, i) => (
                                    <span key={i} className="flex items-center gap-1 text-ink-400">
                                      <span className="truncate font-normal">{segment}</span>
                                      <ChevronRight className="h-3 w-3 flex-shrink-0 text-ink-600" />
                                    </span>
                                  ))}
                                  <span className="truncate">{path[path.length - 1]}</span>
                                </span>
                              ) : (
                                <span className="truncate">{tag.name}</span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-ink-400">
                              {tag.card_count} {t("library.stats.cards")}
                              {tag.subtag_count > 0 && (
                                <span className="ml-1 text-ink-500">
                                  {" · "}
                                  {t("share.public.inclSubtags", {
                                    count: tag.subtag_count,
                                    defaultValue: "incl. {{count}} sub-tags",
                                  })}
                                </span>
                              )}
                            </p>
                          </div>
                          <SourceIconStub />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
    </PublicShell>
  );
}

function SourceIconStub() {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-ink-700/40 text-ink-300">
      <Hash className="h-4 w-4" />
    </span>
  );
}

function CardHitTile({
  card,
  onOpen,
}: {
  card: PublicCardSummary;
  onOpen: () => void;
}) {
  const Icon = SOURCE_ICONS[card.source_type] ?? FileText;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-hover group flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-800/40 text-left transition hover:border-ink-600"
    >
      <div className="aspect-video w-full overflow-hidden bg-ink-800">
        {card.thumbnail_url ? (
          <img
            src={card.thumbnail_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className="h-7 w-7 text-ink-600" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
          <Icon className="h-3 w-3" />
          {card.source_type}
        </span>
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-100">
          {card.title}
        </h3>
        {card.concise_summary_md && (
          <p className="line-clamp-2 text-xs text-ink-400">{card.concise_summary_md}</p>
        )}
      </div>
    </button>
  );
}

// keep tree-shaking happy (some imports unused on the basic page)
void SOURCE_ICONS;
