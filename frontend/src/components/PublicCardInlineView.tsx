import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import CardCinemaLayout from "./CardCinemaLayout";
import MarkdownView from "./MarkdownView";
import type { PublicCard } from "../lib/api";

/**
 * Inline read-only view of a public card. Used on the public tag page
 * and the public profile (search hits) — both want the same two-column
 * cinema layout with a sticky video / thumbnail on the left and the
 * markdown summary on the right.
 *
 * The `?t=<seconds>` URL param is read by `CardMedia` to deep-link a
 * YouTube iframe to a specific timestamp; `CardDetailBody` writes it
 * when the user clicks a `[t=NN]` pill inside the summary text.
 */
export function PublicCardInlineView({ card }: { card: PublicCard }) {
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
    <CardCinemaLayout video={() => <PublicCardMedia card={card} />}>
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
    </CardCinemaLayout>
  );
}

function PublicCardMedia({ card }: { card: PublicCard }) {
  const [searchParams] = useSearchParams();
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
