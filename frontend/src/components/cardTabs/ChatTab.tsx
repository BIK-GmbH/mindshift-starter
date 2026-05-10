import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import CardSourceMedia from "../CardSourceMedia";
import ChatPanel from "../ChatPanel";
import { api, type Card } from "../../lib/api";

interface ChatTabProps {
  card: Card;
  /** When true, show the "Show video" toggle + the source-media panel inline.
   *  When false (default), only the chat panel renders — assume the source
   *  media is rendered elsewhere (e.g. above the tab strip in the path player). */
  showSourceMedia?: boolean;
}

export default function ChatTab({ card, showSourceMedia = false }: ChatTabProps) {
  const { t } = useTranslation();
  const [playerVisible, setPlayerVisible] = useState(false);
  const hasMedia = showSourceMedia && card.source_type === "youtube" && !!card.external_id;
  const playerOpen = hasMedia && playerVisible;

  return (
    <div className="flex flex-col gap-3" style={{ height: "min(80vh, 900px)" }}>
      {hasMedia && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setPlayerVisible((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/50 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
          >
            {playerOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {playerOpen
              ? t("cardSource.hidePlayer", { defaultValue: "Hide video" })
              : t("cardSource.showPlayer", { defaultValue: "Show video" })}
          </button>
        </div>
      )}
      {playerOpen && (
        <div className="min-h-0 flex-1">
          <CardSourceMedia card={card} fitHeight />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          send={(history) => api.chatCard(card.id, history)}
          placeholder={t("chat.placeholderCard") ?? ""}
          emptyHint={t("chat.cardEmpty") ?? ""}
        />
      </div>
    </div>
  );
}
