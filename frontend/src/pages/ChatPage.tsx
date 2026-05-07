import { useTranslation } from "react-i18next";

import ChatPanel from "../components/ChatPanel";
import { api } from "../lib/api";

export default function ChatPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.chat")}</h1>
        <p className="text-sm text-ink-300">{t("chat.kbSubtitle")}</p>
      </header>
      <div className="flex-1 min-h-0">
        <ChatPanel
          send={(history) => api.chatKb(history)}
          placeholder={t("chat.placeholderKb") ?? ""}
          emptyHint={t("chat.kbEmpty") ?? ""}
        />
      </div>
    </div>
  );
}
