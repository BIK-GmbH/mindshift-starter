import { Brain, Check, Copy, FileText, Github, Globe, Loader2, Share2, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import RailFooterButtons from "../components/RailFooterButtons";
import { api, type PublicCard } from "../lib/api";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  article: Globe,
  pdf: FileText,
  note: FileText,
  github: Github,
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
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 surface-soft"
          title={t("app.name")}
        >
          <Brain className="h-4 w-4" />
        </div>
        <div className="flex-1" />
        <RailFooterButtons showSettings={false} />
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
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const url = window.location.href;
    const title = card.title;
    const text = card.concise_summary_md ?? "";
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        /* user cancelled — fall back to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <article className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-500">
            <Icon className="h-3 w-3" />
            {card.source_type}
            <span className="mx-2 text-ink-600">·</span>
            <span>{t("share.public.tag", { defaultValue: "Shared via Mindshift" })}</span>
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink-100">
            {card.title}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void onShare()}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-700/40 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : "share" in (typeof navigator !== "undefined" ? navigator : {}) ? <Share2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied
            ? t("share.copied", { defaultValue: "Link copied" })
            : t("share.public.shareAction", { defaultValue: "Share" })}
        </button>
      </header>

      <CardMedia card={card} />

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
          <div className="rounded-lg border border-ink-800 bg-ink-800/40 px-5 py-4">
            <MarkdownView source={card.detailed_summary_md} />
          </div>
        </section>
      )}

      {card.notes_md && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {t("share.public.notes", { defaultValue: "Notes" })}
          </h2>
          <div className="rounded-lg border border-ink-800 bg-ink-800/40 px-5 py-4">
            <MarkdownView source={card.notes_md} />
          </div>
        </section>
      )}

      <footer className="border-t border-ink-800 pt-4 text-xs text-ink-500">
        {t("share.public.footer", { defaultValue: "This is a read-only view of a Mindshift card." })}
      </footer>
    </article>
  );
}

function CardMedia({ card }: { card: PublicCard }) {
  if (card.source_type === "youtube" && card.external_id) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl ring-1 ring-ink-800">
        <iframe
          src={`https://www.youtube.com/embed/${card.external_id}`}
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
        className="group block overflow-hidden rounded-xl ring-1 ring-ink-800 transition hover:ring-ink-500"
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
        className="aspect-video w-full rounded-xl object-cover ring-1 ring-ink-800"
      />
    );
  }
  return null;
}
