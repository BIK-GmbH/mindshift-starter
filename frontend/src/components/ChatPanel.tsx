import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { ChatMessage, ChatResponse, Citation } from "../lib/api";

interface Props {
  send: (history: ChatMessage[]) => Promise<ChatResponse>;
  placeholder?: string;
  emptyHint?: string;
}

interface UiMessage extends ChatMessage {
  id: string;
  citations?: Citation[];
}

export default function ChatPanel({ send, placeholder, emptyHint }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response = await send(
        nextHistory.map(({ role, content }) => ({ role, content })),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          citations: response.citations,
        },
      ]);
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-3">
        {messages.length === 0 && emptyHint && (
          <p className="text-xs text-ink-400">{emptyHint}</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-900"
                : "max-w-[95%] rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-100"
            }
          >
            {m.role === "assistant" ? (
              <AssistantMessage content={m.content} citations={m.citations ?? []} onOpen={(id) => navigate(`/cards/${id}`)} />
            ) : (
              <span className="whitespace-pre-wrap">{m.content}</span>
            )}
          </div>
        ))}
        {busy && (
          <div className="max-w-[95%] rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-300">
            <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-ink-700 pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
          placeholder={placeholder ?? t("chat.placeholder") ?? ""}
          rows={2}
          className="flex-1 resize-none rounded border border-ink-600 bg-ink-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-200 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}

function AssistantMessage({
  content,
  citations,
  onOpen,
}: {
  content: string;
  citations: Citation[];
  onOpen: (cardId: string) => void;
}) {
  const byIndex = new Map(citations.map((c) => [c.index, c]));

  // Replace [#n] with clickable buttons.
  const parts: (string | { citation: Citation })[] = [];
  const re = /\[#(\d+)\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIdx) parts.push(content.slice(lastIdx, m.index));
    const c = byIndex.get(Number(m[1]));
    if (c) parts.push({ citation: c });
    else parts.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) parts.push(content.slice(lastIdx));

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap leading-relaxed">
        {parts.map((p, i) =>
          typeof p === "string" ? (
            <span key={i}>{p}</span>
          ) : (
            <button
              key={i}
              type="button"
              title={p.citation.title}
              onClick={() => onOpen(p.citation.card_id)}
              className="mx-0.5 inline-flex items-center rounded bg-ink-700 px-1.5 text-[10px] font-medium text-ink-100 hover:bg-ink-600"
            >
              #{p.citation.index}
            </button>
          ),
        )}
      </p>
      {citations.length > 0 && (
        <div className="border-t border-ink-700 pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">Sources</p>
          <ul className="space-y-1">
            {citations.map((c) => (
              <li key={c.index}>
                <button
                  type="button"
                  onClick={() => onOpen(c.card_id)}
                  className="block w-full text-left text-xs text-ink-200 hover:text-ink-100"
                >
                  <span className="mr-1 rounded bg-ink-700 px-1 text-[10px]">#{c.index}</span>
                  <span className="font-medium">{c.title}</span>
                  <span className="ml-1 text-ink-400">({c.source_type})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
