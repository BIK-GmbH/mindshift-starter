import { ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type Card } from "../lib/api";

interface Props {
  cardId: string | null;
  onClose: () => void;
}

export default function GraphCardDrawer({ cardId, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cardId) {
      setCard(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void api.getCard(cardId).then((c) => {
      if (!cancelled) {
        setCard(c);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (!cardId) return null;

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-96 flex-col border-l border-ink-700 bg-ink-800 surface-elevated">
      <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <span className="text-[10px] uppercase tracking-wide text-ink-400">
          {t("graph.drawer.title")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-300 hover:text-ink-100"
          aria-label={t("common.cancel") ?? ""}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {loading || !card ? (
          <div className="flex items-center gap-2 text-ink-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-4">
            {card.thumbnail_url && (
              <img
                src={card.thumbnail_url}
                alt=""
                className="aspect-video w-full rounded object-cover"
              />
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wide text-ink-400">
                {card.source_type}
              </span>
              <h3 className="text-base font-semibold leading-snug text-ink-100">
                {card.title}
              </h3>
            </div>

            {card.concise_summary_md && (
              <section>
                <h4 className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">
                  {t("card.summary")}
                </h4>
                <p className="text-ink-200">{card.concise_summary_md}</p>
              </section>
            )}

            {card.key_takeaways_json && card.key_takeaways_json.length > 0 && (
              <section>
                <h4 className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">
                  Key takeaways
                </h4>
                <ul className="list-inside list-disc space-y-1 text-ink-200">
                  {card.key_takeaways_json.slice(0, 5).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-ink-700 p-3">
        <button
          type="button"
          onClick={() => cardId && navigate(`/cards/${cardId}`)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-200"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("graph.drawer.openCard")}
        </button>
      </footer>
    </aside>
  );
}
