import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import { api, tokenStorage, type Card } from "../lib/api";

/**
 * Embedded card view for the browser extension's side panel.
 *
 * Designed for narrow widths (~360–500 px), NOT a reuse of the full
 * card-detail layout (which assumes 1024 px+ and breaks at side-panel
 * widths — the title stacks vertically, action bar overflows, content
 * doesn't scroll). Renders a Recall-style condensed read view: thumb,
 * title, source pill, tags, concise summary, key takeaways, and a CTA
 * to open the full card detail in a new tab.
 *
 * Loaded inside an `<iframe>` from the extension; shares localStorage
 * with the main Mindshift tab so the JWT is already there. If the
 * user isn't signed in here, we show a one-line prompt.
 */
export default function EmbedCardPage() {
  const { cardId = "" } = useParams<{ cardId: string }>();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tok = tokenStorage.get();
    setHasToken(!!tok);
    if (!tok) return;
    void (async () => {
      try {
        const data = await api.getCard(cardId);
        setCard(data);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [cardId]);

  if (hasToken === null) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 px-4 text-center text-xs text-ink-400">
        Open Mindshift in another tab and sign in — the side panel
        shares your session automatically.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 px-4 text-center text-xs text-red-300">
        {error}
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  const takeaways = card.key_takeaways_json ?? [];
  // Resolve the web app URL from the same origin we're loaded at —
  // the iframe lives on the Mindshift web host so window.location is
  // reliable here.
  const webOrigin = window.location.origin;
  const sourceBadge = card.source_type.toUpperCase();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-900 text-ink-100">
      {/* Header — sticky, brand band */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          {sourceBadge}
          {card.status !== "completed" && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">
              {card.status}
            </span>
          )}
        </div>
        <a
          href={`${webOrigin}/?card=${card.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[10px] font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </a>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Thumbnail */}
        {card.thumbnail_url && (
          <div className="aspect-video w-full bg-ink-800">
            <img
              src={card.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="space-y-3 p-3">
          {/* Title */}
          <h1 className="text-base font-semibold leading-snug text-ink-100">
            {card.title}
          </h1>

          {/* Tags */}
          {card.tags && card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Concise summary */}
          {card.concise_summary_md && (
            <section>
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                TL;DR
              </h2>
              <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed text-ink-200">
                <MarkdownView source={card.concise_summary_md} />
              </div>
            </section>
          )}

          {/* Key takeaways */}
          {takeaways.length > 0 && (
            <section>
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Key takeaways
              </h2>
              <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink-200">
                {takeaways.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex-shrink-0 text-ink-600">•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Notes preview if present */}
          {card.notes_md && (
            <section>
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Notes
              </h2>
              <div className="prose prose-invert prose-sm max-w-none rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[12px] text-ink-200">
                <MarkdownView source={card.notes_md} />
              </div>
            </section>
          )}

          {/* Open-full CTA */}
          <a
            href={`${webOrigin}/?card=${card.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-ink-100 px-3 py-2 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open full card in Mindshift
          </a>
        </div>
      </div>
    </div>
  );
}
