import { Bot, Lightbulb, Loader2, Send, User } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { ChatMessage, ChatResponse, Citation, PersistedChatMessage } from "../lib/api";

interface Props {
  send: (history: ChatMessage[]) => Promise<ChatResponse>;
  placeholder?: string;
  emptyHint?: string;
  suggestions?: string[];
  /** Pre-fill panel with a previously persisted conversation. */
  initialMessages?: PersistedChatMessage[];
  /** Fire when the backend assigns/echoes a session id (so the page can
   *  refresh the sidebar listing or pin the URL). */
  onSessionId?: (id: string) => void;
}

interface UiMessage extends ChatMessage {
  id: string;
  citations?: Citation[];
}

function persistedToUi(msgs: PersistedChatMessage[]): UiMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations_json ?? undefined,
  }));
}

export default function ChatPanel({
  send,
  placeholder,
  emptyHint,
  suggestions,
  initialMessages,
  onSessionId,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    initialMessages ? persistedToUi(initialMessages) : [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // When the parent swaps in a different session, replace the message list.
  useEffect(() => {
    setMessages(initialMessages ? persistedToUi(initialMessages) : []);
  }, [initialMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submitText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response = await send(nextHistory.map(({ role, content }) => ({ role, content })));
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          citations: response.citations,
        },
      ]);
      if (response.session_id && onSessionId) onSessionId(response.session_id);
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitText(input);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
        {messages.length === 0 && (
          <EmptyState
            hint={emptyHint}
            suggestions={suggestions}
            onPick={(prompt) => void submitText(prompt)}
          />
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onOpenCard={(id) => navigate(`/cards/${id}`)}
          />
        ))}
        {busy && (
          <div className="flex items-start gap-2.5">
            <Avatar role="assistant" />
            <div className="rounded-2xl rounded-tl-sm border border-ink-700 bg-ink-800 px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-1.5 text-ink-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="surface-soft flex items-end gap-2 rounded-2xl border border-transparent bg-ink-800/40 p-2 focus-within:border-ink-500"
      >
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
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
          style={{ minHeight: "1.75rem", maxHeight: "10rem" }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={[
        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px]",
        role === "user"
          ? "bg-ink-100 text-ink-900"
          : "bg-ink-700 text-ink-100 ring-1 ring-ink-600",
      ].join(" ")}
    >
      {role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
    </div>
  );
}

function MessageBubble({
  message,
  onOpenCard,
}: {
  message: UiMessage;
  onOpenCard: (id: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex flex-row-reverse items-start gap-2.5">
        <Avatar role="user" />
        <div className="surface-soft max-w-[85%] rounded-2xl rounded-tr-sm bg-ink-100 px-4 py-2.5 text-sm text-ink-900">
          <span className="whitespace-pre-wrap">{message.content}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <Avatar role="assistant" />
      <div className="surface-soft max-w-[90%] rounded-2xl rounded-tl-sm border border-transparent bg-ink-800 px-4 py-3 text-sm text-ink-100">
        <AssistantMessage
          content={message.content}
          citations={message.citations ?? []}
          onOpen={onOpenCard}
        />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const { t } = useTranslation();

  // Render markdown to HTML with inline citation pills baked in.
  // The trick: pre-replace [#n] with an inline <a> element marked with
  // data-cite-id BEFORE handing the text to marked. marked passes
  // inline HTML through unchanged, so the pill ends up correctly placed
  // inside whatever paragraph / list-item / blockquote it lived in.
  // Click delegation on the wrapper turns the pill into a button.
  const html = useMemo(() => {
    const byIndex = new Map(citations.map((c) => [c.index, c]));
    const withPills = content.replace(/\[#(\d+)\]/g, (match, n) => {
      const c = byIndex.get(Number(n));
      if (!c) return match;
      return ` <a class="chat-cite" data-cite-id="${c.card_id}" data-cite-n="${n}" href="#" title="${escapeHtml(c.title)}">[#${n}]</a>`;
    });
    return marked.parse(withPills, { async: false }) as string;
  }, [content, citations]);

  const onWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cite-id]");
    if (!target) return;
    e.preventDefault();
    const cardId = target.getAttribute("data-cite-id");
    if (cardId) onOpen(cardId);
  };

  return (
    <div className="space-y-3">
      <div
        className="markdown-body chat-markdown text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={onWrapperClick}
      />
      {citations.length > 0 && (
        <div className="border-t border-ink-700/60 pt-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            {t("chat.sources", { defaultValue: "Sources" })}
          </p>
          <ul className="space-y-1">
            {citations.map((c) => (
              <li key={c.index}>
                <button
                  type="button"
                  onClick={() => onOpen(c.card_id)}
                  className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink-300 transition hover:bg-ink-700/40 hover:text-ink-100"
                >
                  <span className="rounded bg-ink-700 px-1 text-[10px] font-semibold text-ink-100">
                    #{c.index}
                  </span>
                  <span className="truncate font-medium">{c.title}</span>
                  <span className="text-[10px] text-ink-500">({c.source_type})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  hint,
  suggestions,
  onPick,
}: {
  hint?: string;
  suggestions?: string[];
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 ring-1 ring-ink-700">
        <Lightbulb className="h-5 w-5 text-ink-300" />
      </div>
      {hint && <p className="mb-5 max-w-md text-sm text-ink-400">{hint}</p>}
      {suggestions && suggestions.length > 0 && (
        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-xl border border-ink-800 bg-ink-800/40 px-3 py-2.5 text-left text-xs leading-snug text-ink-200 transition hover:-translate-y-0.5 hover:border-ink-600 hover:bg-ink-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
