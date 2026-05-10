import { Brain, FileText, Github, Globe, Hash, Loader2, Sparkles, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import RailFooterButtons from "../components/RailFooterButtons";
import { api, type PublicProfileOut } from "../lib/api";
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
    <div className="flex h-full bg-ink-900">
      <aside className="flex w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3">
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 surface-soft"
          role="img"
          aria-label={t("app.name")}
        >
          <Brain className="h-4 w-4" />
        </div>
        <div className="flex-1" />
        <RailFooterButtons />
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 pb-16 pt-12 page-enter">
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
              <header className="mb-10 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
                {profile.avatar_file_id ? (
                  <img
                    src={api.publicAvatarUrl(profile.avatar_file_id)}
                    alt=""
                    className="h-20 w-20 flex-shrink-0 rounded-full object-cover ring-2 ring-ink-700"
                  />
                ) : (
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 text-2xl font-bold text-ink-900">
                    {(profile.display_name || profile.username || "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold text-ink-100">
                    {profile.display_name || profile.username}
                  </h1>
                  <p className="text-sm text-ink-400">@{profile.username}</p>
                  {profile.bio && (
                    <p className="mt-2 text-sm leading-relaxed text-ink-300">{profile.bio}</p>
                  )}
                </div>
              </header>

              {profile.paths.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                    {t("paths.title", { defaultValue: "Paths" })}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {profile.paths.map((p) => (
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
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {profile.tags.map((tag) => (
                      <Link
                        key={tag.slug}
                        to={`/u/${profile.username}/${encodeURI(tag.slug)}`}
                        className="card-hover group flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-800/40 px-5 py-4 transition hover:border-ink-600"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold text-ink-100">
                            <Hash className="-mt-1 mr-1 inline h-4 w-4 text-ink-500" />
                            {tag.name}
                          </p>
                          <p className="text-[11px] text-ink-400">
                            {tag.card_count} {t("library.stats.cards")}
                          </p>
                        </div>
                        <SourceIconStub />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SourceIconStub() {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-ink-700/40 text-ink-300">
      <Hash className="h-4 w-4" />
    </span>
  );
}

// keep tree-shaking happy (some imports unused on the basic page)
void SOURCE_ICONS;
