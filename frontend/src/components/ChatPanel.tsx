import { Bot, ExternalLink, Globe, Lightbulb, Loader2, Send, User } from "lucide-react";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import VoiceRecordButton from "./VoiceRecordButton";
import type {
  ChatMessage,
  ChatResponse,
  Citation,
  PersistedChatMessage,
  WebCitation,
} from "../lib/api";
import { insertAtCaret } from "../lib/insertAtCaret";

interface Props {
  /** Callback to send a message history to the backend. The `options`
   *  argument carries client-side toggles (e.g. web-search) that don't
   *  belong in the history but do belong in the request body. */
  send: (
    history: ChatMessage[],
    options?: { useWebSearch?: boolean },
  ) => Promise<ChatResponse>;
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
  webCitations?: WebCitation[];
}

const WEB_SEARCH_STORAGE_KEY = "mindshift.chat.useWebSearch";

function persistedToUi(msgs: PersistedChatMessage[]): UiMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations_json ?? undefined,
    webCitations: m.web_citations_json ?? undefined,
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
  // Web-search toggle — sticky across page reloads so the user doesn't
  // re-enable it for every conversation. Per-tab (localStorage), not
  // per-session — that matches the "I want web by default for a while"
  // mental model.
  const [useWebSearch, setUseWebSearch] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WEB_SEARCH_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleWebSearch = useCallback(() => {
    setUseWebSearch((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(WEB_SEARCH_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* private-mode / disabled storage — toggle still works in-memory */
      }
      return next;
    });
  }, []);

  const onVoice = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      const { next, caret } = insertAtCaret(ta, input, text);
      setInput(next);
      setTimeout(() => {
        if (ta) {
          ta.setSelectionRange(caret, caret);
          ta.focus();
        }
      }, 0);
    },
    [input],
  );

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
      const response = await send(
        nextHistory.map(({ role, content }) => ({ role, content })),
        { useWebSearch },
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          webCitations: response.web_citations,
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
          ref={textareaRef}
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
          type="button"
          onClick={toggleWebSearch}
          title={
            useWebSearch
              ? t("chat.webSearchOnTitle", { defaultValue: "Web search is ON — click to turn off" }) ?? ""
              : t("chat.webSearchOffTitle", { defaultValue: "Turn web search ON" }) ?? ""
          }
          aria-pressed={useWebSearch}
          aria-label={t("chat.webSearch", { defaultValue: "Web search" }) ?? "Web search"}
          className={[
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors",
            useWebSearch
              ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40"
              : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
          ].join(" ")}
        >
          <Globe className="h-4 w-4" />
        </button>
        <VoiceRecordButton onTranscribed={onVoice} showStatusLine={true} />
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
          webCitations={message.webCitations ?? []}
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
  webCitations,
  onOpen,
}: {
  content: string;
  citations: Citation[];
  webCitations: WebCitation[];
  onOpen: (cardId: string) => void;
}) {
  const { t } = useTranslation();

  // Render markdown to HTML with inline citation pills baked in.
  // The trick: pre-replace [#n] with an inline <a> element marked with
  // data-cite-id BEFORE handing the text to marked. marked passes
  // inline HTML through unchanged, so the pill ends up correctly placed
  // inside whatever paragraph / list-item / blockquote it lived in.
  // Click delegation on the wrapper turns the pill into a button.
  // [W#n] tokens are rendered the same way but link out to the web URL.
  const html = useMemo(() => {
    const byIndex = new Map(citations.map((c) => [c.index, c]));
    const byWebIndex = new Map(webCitations.map((w) => [w.index, w]));
    // Order matters: [W#n] is a superset of [#n] visually, so handle
    // the W-form first to avoid the bare [#n] regex from gobbling its
    // digits prematurely.
    let withPills = content.replace(/\[W#(\d+)\]/g, (match, n) => {
      const w = byWebIndex.get(Number(n));
      if (!w) return match;
      return ` <a class="chat-cite chat-cite-web" data-cite-web="${escapeHtml(w.url)}" href="${escapeHtml(w.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(w.title)}">[W#${n}]</a>`;
    });
    withPills = withPills.replace(/\[#(\d+)\]/g, (match, n) => {
      const c = byIndex.get(Number(n));
      if (!c) return match;
      return ` <a class="chat-cite" data-cite-id="${c.card_id}" data-cite-n="${n}" href="#" title="${escapeHtml(c.title)}">[#${n}]</a>`;
    });
    return marked.parse(withPills, { async: false }) as string;
  }, [content, citations, webCitations]);

  const onWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cite-id]");
    if (!target) return;
    // Web pills are real anchors with target=_blank — let the browser
    // handle them. Only intercept card pills (data-cite-id without
    // an http URL).
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
      {webCitations.length > 0 && (
        <div className="border-t border-ink-700/60 pt-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300">
            <Globe className="h-3 w-3" />
            {t("chat.webSources", { defaultValue: "Web sources" })}
          </p>
          <ul className="space-y-1">
            {webCitations.map((w) => (
              <li key={w.index}>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-xs text-ink-300 transition hover:bg-ink-700/40 hover:text-ink-100"
                >
                  <span className="mt-0.5 flex-shrink-0 rounded bg-sky-500/20 px-1 text-[10px] font-semibold text-sky-200">
                    W#{w.index}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{w.title}</span>
                    <span className="block truncate text-[10px] text-ink-500" title={w.url}>
                      {w.url}
                    </span>
                  </span>
                  <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-ink-500 group-hover:text-ink-300" />
                </a>
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
