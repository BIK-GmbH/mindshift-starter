import { BookOpen, FileText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import MarkdownView from "../MarkdownView";
import type { Card, CardTranslationOut } from "../../lib/api";
import { Section } from "./Section";

interface SummaryTabProps {
  card: Card;
  activeTranslation: CardTranslationOut | null;
}

export default function SummaryTab({ card, activeTranslation }: SummaryTabProps) {
  const { t } = useTranslation();
  const conciseSummary = activeTranslation?.concise_summary_md ?? card.concise_summary_md;
  const detailedSummary = activeTranslation?.detailed_summary_md ?? card.detailed_summary_md;
  const takeaways = activeTranslation?.key_takeaways_json ?? card.key_takeaways_json ?? [];

  return (
    <div className="space-y-8 text-sm leading-relaxed">
      {conciseSummary && (
        <Section icon={BookOpen} label={t("card.tldr", { defaultValue: "TL;DR" })}>
          <p className="text-base text-ink-100/90">{conciseSummary}</p>
        </Section>
      )}

      {takeaways.length > 0 && (
        <Section icon={Sparkles} label={t("card.summary") + " — Key Takeaways"}>
          <ul className="grid gap-2 md:grid-cols-2">
            {takeaways.map((point, idx) => (
              <li
                key={idx}
                className="surface-soft group flex items-start gap-2 rounded-md border border-transparent bg-ink-800/40 p-3 text-ink-200 transition hover:bg-ink-800/70"
              >
                <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 transition group-hover:bg-ink-200" />
                <span>{typeof point === "string" ? point : (point as { text?: string })?.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detailedSummary && (
        <Section icon={FileText} label={t("card.summary")}>
          <MarkdownView source={detailedSummary} />
        </Section>
      )}
    </div>
  );
}
