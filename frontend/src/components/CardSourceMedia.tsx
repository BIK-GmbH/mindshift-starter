import {
  ExternalLink,
  GitBranch,
  GitFork,
  Github,
  Maximize2,
  Minimize2,
  Scale,
  Star,
  Youtube,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { Card, GithubSourceMetadata } from "../lib/api";

interface Props {
  card: Card;
}

/**
 * Source playback for the card-detail page.
 *
 * - YouTube: inline iframe, with a maximize button that morphs the
 *   player into a viewport-sized overlay via the View Transitions API
 *   (same pattern as the rich-text editor fullscreen). ESC closes.
 * - Article / wiki / pdf: small "Open original" banner that links to
 *   the source URL in a new tab.
 * - Notes / no source: nothing rendered.
 */
export default function CardSourceMedia({ card }: Props) {
  const { t } = useTranslation();
  const [fullscreen, setFullscreen] = useState(false);

  // ESC closes fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const toggleFullscreen = () => {
    type DocVT = Document & { startViewTransition?: (cb: () => void) => unknown };
    const doc = document as DocVT;
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => setFullscreen((v) => !v));
    } else {
      setFullscreen((v) => !v);
    }
  };

  if (card.source_type === "youtube" && card.external_id) {
    const embedSrc = `https://www.youtube.com/embed/${card.external_id}`;
    const watchUrl = card.source_url || `https://www.youtube.com/watch?v=${card.external_id}`;
    const player = (
      <div
        className={[
          "relative overflow-hidden rounded-xl ring-1 ring-ink-700",
          fullscreen ? "h-full w-full" : "aspect-video w-full",
        ].join(" ")}
        style={{ viewTransitionName: "card-player" }}
      >
        <iframe
          src={embedSrc}
          title={card.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full"
        />
        <div className="absolute right-2 top-2 flex gap-1">
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t("cardSource.openOriginal", { defaultValue: "Open on YouTube" }) ?? ""}
            className="rounded-md bg-ink-900/70 p-1.5 text-ink-100 transition hover:bg-ink-800"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={
              fullscreen
                ? t("cardSource.exitFullscreen", { defaultValue: "Exit fullscreen" }) ?? ""
                : t("cardSource.fullscreen", { defaultValue: "Maximize" }) ?? ""
            }
            className="rounded-md bg-ink-900/70 p-1.5 text-ink-100 transition hover:bg-ink-800"
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    );

    if (fullscreen) {
      return createPortal(
        <div className="fixed inset-0 z-[60] bg-ink-900/90 backdrop-blur-md">
          <div className="absolute inset-0 flex items-center justify-center px-4 py-[5vh]">
            <div className="flex h-full w-full max-w-6xl items-stretch">
              {player}
            </div>
          </div>
        </div>,
        document.body,
      );
    }
    return player;
  }

  // GitHub repo: rich repo card with stars / forks / topics / license
  if (card.source_type === "github" && card.source_url) {
    return <GithubRepoCard card={card} t={t} />;
  }

  // Article / wiki / pdf / other URL → "open original" link
  if (card.source_url && card.source_type !== "note") {
    const Icon =
      card.source_type === "youtube"
        ? Youtube
        : card.source_type === "github"
          ? Github
          : ExternalLink;
    return (
      <a
        href={card.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="surface-soft flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2 text-xs text-ink-200 transition hover:bg-ink-700/40 hover:text-ink-100"
        title={card.source_url}
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-ink-400" />
        <span className="flex-1 truncate font-mono">{card.source_url}</span>
        <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-ink-500">
          {t("cardSource.open", { defaultValue: "Open" })}
        </span>
      </a>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* GitHub repo card                                                    */
/* ------------------------------------------------------------------ */

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface GithubRepoCardProps {
  card: Card;
  t: ReturnType<typeof useTranslation>["t"];
}

function GithubRepoCard({ card, t }: GithubRepoCardProps) {
  const meta = (card.source_metadata ?? {}) as GithubSourceMetadata;
  const repoUrl = card.source_url || "#";
  const fullName = meta.full_name || `${meta.owner ?? ""}/${meta.repo ?? ""}`.replace(/^\//, "");
  const description = meta.description || null;
  const stars = typeof meta.stars === "number" ? meta.stars : null;
  const forks = typeof meta.forks === "number" ? meta.forks : null;
  const language = meta.language || null;
  const license = meta.license || null;
  const topics = Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [];
  const branch = meta.default_branch || null;
  const homepage = meta.homepage || null;

  return (
    <div className="overflow-hidden rounded-xl border border-ink-700 bg-gradient-to-br from-violet-500/10 via-ink-800/40 to-ink-900/40 ring-1 ring-violet-500/20">
      <div className="flex flex-col gap-3 p-4">
        {/* Header: icon + owner/repo + open link */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex-shrink-0 rounded-lg bg-violet-500/20 p-2 text-violet-300 ring-1 ring-violet-500/30">
              <Github className="h-4 w-4" />
            </div>
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate font-mono text-sm font-semibold text-ink-100 transition hover:text-violet-300"
            >
              {fullName || repoUrl}
            </a>
          </div>
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t("cardSource.openOriginal", { defaultValue: "Open on GitHub" }) ?? ""}
            className="flex-shrink-0 rounded-md border border-ink-700 bg-ink-900/60 p-1.5 text-ink-300 transition hover:border-violet-500/40 hover:text-violet-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {description && (
          <p className="text-sm leading-relaxed text-ink-200">{description}</p>
        )}

        {/* Stats row */}
        {(stars !== null || forks !== null || language || license || branch) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-300">
            {stars !== null && (
              <span className="inline-flex items-center gap-1.5" title={`${stars} stars`}>
                <Star className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-medium tabular-nums">{NUMBER_FORMAT.format(stars)}</span>
              </span>
            )}
            {forks !== null && (
              <span className="inline-flex items-center gap-1.5" title={`${forks} forks`}>
                <GitFork className="h-3.5 w-3.5 text-ink-400" />
                <span className="tabular-nums">{NUMBER_FORMAT.format(forks)}</span>
              </span>
            )}
            {language && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                <span>{language}</span>
              </span>
            )}
            {license && (
              <span className="inline-flex items-center gap-1.5" title={`License: ${license}`}>
                <Scale className="h-3.5 w-3.5 text-ink-400" />
                <span>{license}</span>
              </span>
            )}
            {branch && (
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-ink-400" />
                <span className="font-mono">{branch}</span>
              </span>
            )}
          </div>
        )}

        {/* Topics */}
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200"
              >
                {topic}
              </span>
            ))}
          </div>
        )}

        {/* Homepage link */}
        {homepage && (
          <a
            href={homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ink-400 transition hover:text-violet-300"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate">{homepage}</span>
          </a>
        )}
      </div>
    </div>
  );
}
