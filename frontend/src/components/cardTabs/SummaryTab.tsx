import { BookOpen, FileText, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import MarkdownView from "../MarkdownView";
import type { Card, CardTranslationOut } from "../../lib/api";
import { Section } from "./Section";

interface SummaryTabProps {
  card: Card;
  activeTranslation: CardTranslationOut | null;
}

export default function SummaryTab({ card, activeTranslation }: SummaryTabProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const conciseSummary = activeTranslation?.concise_summary_md ?? card.concise_summary_md;
  const detailedSummary = activeTranslation?.detailed_summary_md ?? card.detailed_summary_md;
  const takeaways = activeTranslation?.key_takeaways_json ?? card.key_takeaways_json ?? [];

  // Pass video coordinates down so MarkdownView can render `[t=NN]`
  // markers in the AI-generated summaries as clickable timestamp pills.
  const videoId = card.source_type === "youtube" ? card.external_id ?? null : null;
  const sourceUrl = card.source_url ?? null;

  // Wire pill clicks to the embedded player by writing the `?t=` URL
  // param. CardSourceMedia reads it and rebuilds the iframe src with
  // `start=…&autoplay=1`. Only for YouTube cards — non-video sources
  // fall through to the default (external link) behavior.
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
    <div className="space-y-8 text-sm leading-relaxed">
      {conciseSummary && (
        <Section icon={BookOpen} label={t("card.tldr", { defaultValue: "TL;DR" })}>
          {/* Use MarkdownView so [t=NN] markers in the concise summary
              get rewritten to clickable pills. The text-base styling is
              kept via the className override. */}
          <MarkdownView
            source={conciseSummary}
            youtubeVideoId={videoId}
            youtubeUrl={sourceUrl}
            onTimestampClick={onTimestampClick}
            className="text-base text-ink-100/90"
          />
        </Section>
      )}

      {takeaways.length > 0 && (
        <Section icon={Sparkles} label={t("card.summary") + " — Key Takeaways"}>
          <ul className="grid gap-2 md:grid-cols-2">
            {takeaways.map((point, idx) => {
              const text =
                typeof point === "string" ? point : (point as { text?: string })?.text ?? "";
              return (
                <li
                  key={idx}
                  className="surface-soft group flex items-start gap-2 rounded-md border border-transparent bg-ink-800/40 p-3 text-ink-200 transition hover:bg-ink-800/70"
                >
                  <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 transition group-hover:bg-ink-200" />
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
        </Section>
      )}

      {detailedSummary && (
        <Section icon={FileText} label={t("card.summary")}>
          <MarkdownView
            source={detailedSummary}
            youtubeVideoId={videoId}
            youtubeUrl={sourceUrl}
            onTimestampClick={onTimestampClick}
          />
        </Section>
      )}
    </div>
  );
}
