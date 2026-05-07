import { Brain, FileText, Globe, Loader2, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import RailFooterButtons from "../components/RailFooterButtons";
import { api, type PublicCard } from "../lib/api";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  note: FileText,
};

/**
 * Public read-only view of a shared card. No auth required — relies on
 * the random token in the URL being unguessable.
 */
export default function PublicCardPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [card, setCard] = useState<PublicCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPublicCard(token)
      .then((data) => {
        if (!cancelled) {
          setCard(data);
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
  }, [token]);

  return (
    <div className="flex h-full bg-ink-900">
      {/* Slim rail with branding + theme/lang toggles only */}
      <aside className="flex w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3">
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 shadow-md"
          title={t("app.name")}
        >
          <Brain className="h-4 w-4" />
        </div>
        <div className="flex-1" />
        <RailFooterButtons />
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-16 pt-10 page-enter">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          )}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
              <p className="font-medium">{t("share.public.errorTitle", { defaultValue: "This share link isn't available." })}</p>
              <p className="mt-1 text-xs text-red-200/80">{error}</p>
            </div>
          )}

          {card && <CardView card={card} />}
        </div>
      </main>
    </div>
  );
}

function CardView({ card }: { card: PublicCard }) {
  const { t } = useTranslation();
  const Icon = SOURCE_ICONS[card.source_type] ?? FileText;

  return (
    <article className="space-y-6">
      <header>
        <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-500">
          <Icon className="h-3 w-3" />
          {card.source_type}
          <span className="mx-2 text-ink-600">·</span>
          <span>{t("share.public.tag", { defaultValue: "Shared via Mindshift" })}</span>
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink-100">
          {card.title}
        </h1>
      </header>

      {card.thumbnail_url && (
        <img
          src={card.thumbnail_url}
          alt=""
          className="aspect-video w-full rounded-xl object-cover ring-1 ring-ink-800"
        />
      )}

      {card.concise_summary_md && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            TL;DR
          </h2>
          <p className="text-base leading-relaxed text-ink-200">{card.concise_summary_md}</p>
        </section>
      )}

      {Array.isArray(card.key_takeaways_json) && card.key_takeaways_json.length > 0 && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {t("share.public.takeaways", { defaultValue: "Key takeaways" })}
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {card.key_takeaways_json.map((item, i) => {
              const text = typeof item === "string" ? item : (item as { text?: string })?.text;
              if (!text) return null;
              return (
                <li
                  key={i}
                  className="rounded-lg border border-ink-800 bg-ink-800/40 p-3 text-sm text-ink-200"
                >
                  {text}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {card.detailed_summary_md && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {t("share.public.summary", { defaultValue: "Summary" })}
          </h2>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-800/40 p-4 font-sans text-sm leading-relaxed text-ink-200">
            {card.detailed_summary_md}
          </pre>
        </section>
      )}

      {card.notes_md && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {t("share.public.notes", { defaultValue: "Notes" })}
          </h2>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-800/40 p-4 font-sans text-sm leading-relaxed text-ink-200">
            {card.notes_md}
          </pre>
        </section>
      )}

      <footer className="border-t border-ink-800 pt-4 text-xs text-ink-500">
        {t("share.public.footer", { defaultValue: "This is a read-only view of a Mindshift card." })}
      </footer>
    </article>
  );
}
