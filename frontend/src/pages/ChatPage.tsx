import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import ChatPanel from "../components/ChatPanel";
import { api } from "../lib/api";

export default function ChatPage() {
  const { t } = useTranslation();

  const suggestedPrompts = [
    "Compare spaced repetition with cramming for long-term retention.",
    "What are the key ideas behind the transformer architecture?",
    "Wie funktioniert Backpropagation einfach erklärt?",
    "Welche Rolle spielt Aufmerksamkeit in modernen LLMs?",
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-8 pb-4 pt-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-700/60 ring-1 ring-ink-700">
              <Sparkles className="h-4 w-4 text-ink-100" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink-100">
                {t("nav.chat")}
              </h1>
              <p className="text-xs text-ink-400">{t("chat.kbSubtitle")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col px-8 pb-6 pt-4">
        <ChatPanel
          send={(history) => api.chatKb(history)}
          placeholder={t("chat.placeholderKb") ?? ""}
          emptyHint={t("chat.kbEmpty") ?? ""}
          suggestions={suggestedPrompts}
        />
      </div>
    </div>
  );
}
