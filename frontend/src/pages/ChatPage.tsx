import { MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import ChatPanel from "../components/ChatPanel";
import MobileDesktopHint from "../components/MobileDesktopHint";
import { useDialog } from "../lib/DialogContext";
import { api, type ChatSessionDetail, type ChatSessionItem } from "../lib/api";
import { playSound } from "../lib/sounds";

export default function ChatPage() {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);

  const suggestedPrompts = [
    "Compare spaced repetition with cramming for long-term retention.",
    "What are the key ideas behind the transformer architecture?",
    "Wie funktioniert Backpropagation einfach erklärt?",
    "Welche Rolle spielt Aufmerksamkeit in modernen LLMs?",
  ];

  const refreshSessions = useCallback(async () => {
    const list = await api.listChatSessions();
    setSessions(list.filter((s) => s.card_id === null));
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Load full conversation when an existing session is selected.
  useEffect(() => {
    if (activeId === null) {
      setActiveSession(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    api
      .getChatSession(activeId)
      .then((session) => {
        if (!cancelled) setActiveSession(session);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const startNew = () => {
    setActiveId(null);
    setActiveSession(null);
    setDraftSessionId(null);
  };

  const onSessionId = useCallback(
    (id: string) => {
      // Backend assigned an id to the in-flight conversation. Pin it.
      setDraftSessionId(id);
      setActiveId(id);
      void refreshSessions();
    },
    [refreshSessions],
  );

  const onDelete = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    const ok = await confirm({
      title: t("chat.history.confirmDeleteTitle", { defaultValue: "Delete this conversation?" }),
      body: t("chat.history.confirmDeleteBody", {
        defaultValue: target
          ? `“${target.title}” will be removed along with all its messages.`
          : "This conversation and all its messages will be removed.",
      }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await api.deleteChatSession(id);
    if (activeId === id) startNew();
    void refreshSessions();
  };

  // Build send fn that always passes the current session id (existing OR draft).
  const sendKb = useCallback(
    (history: Parameters<typeof api.chatKb>[0]) =>
      api.chatKb(history, 5, activeId ?? draftSessionId ?? undefined),
    [activeId, draftSessionId],
  );

  return (
    <div className="flex h-full">
      {/* Conversation history sidebar */}
      <aside className="panel-elevated hidden md:flex w-64 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
            {t("chat.history.heading")}
          </span>
          <button
            type="button"
            onClick={() => {
              playSound("click");
              startNew();
            }}
            title={t("chat.history.newChat") ?? ""}
            className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[10px] font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <Plus className="h-3 w-3" />
            {t("chat.history.newChat")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-ink-500">{t("chat.history.empty")}</p>
          ) : (
            <SessionList
              sessions={sessions}
              activeId={activeId}
              onPick={(id) => setActiveId(id)}
              onDelete={onDelete}
            />
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 min-w-0 flex-col">
        <MobileDesktopHint reasonKey="mobileHint.chat" />
        <div className="page-header">
          <div className="page-header-inner flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-ink-700/60 ring-1 ring-ink-700">
              <Sparkles className="h-4 w-4 text-ink-100" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="page-header-title truncate">
                {activeSession?.title ?? t("nav.chat")}
              </h1>
              <p className="page-header-subtitle">{t("chat.kbSubtitle")}</p>
            </div>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col px-8 pb-6 pt-4">
          {loadingDetail ? (
            <ChatLoadingSkeleton />
          ) : (
            <ChatPanel
              key={activeId ?? "draft"}
              send={sendKb}
              placeholder={t("chat.placeholderKb") ?? ""}
              emptyHint={t("chat.kbEmpty") ?? ""}
              suggestions={activeId ? undefined : suggestedPrompts}
              initialMessages={activeSession?.messages}
              onSessionId={onSessionId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ChatLoadingSkeleton() {
  // Alternating left/right message-shaped placeholders to suggest a
  // conversation while we load it.
  return (
    <div className="flex flex-1 flex-col gap-3 py-2">
      <SkelMsg side="left" widthClass="w-3/5" />
      <SkelMsg side="right" widthClass="w-1/2" delayMs={120} />
      <SkelMsg side="left" widthClass="w-2/3" delayMs={240} />
      <SkelMsg side="right" widthClass="w-2/5" delayMs={360} />
    </div>
  );
}

function SkelMsg({ side, widthClass, delayMs = 0 }: { side: "left" | "right"; widthClass: string; delayMs?: number }) {
  return (
    <div className={["flex", side === "right" ? "justify-end" : "justify-start"].join(" ")}>
      <div
        className={["h-10 animate-pulse rounded-2xl bg-ink-800/60", widthClass].join(" ")}
        style={{ animationDelay: `${delayMs}ms` }}
      />
    </div>
  );
}

function SessionList({
  sessions,
  activeId,
  onPick,
  onDelete,
}: {
  sessions: ChatSessionItem[];
  activeId: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const grouped = groupByDate(sessions);
  return (
    <div className="space-y-3 px-2">
      {grouped.map(({ label, items }) => (
        <div key={label}>
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            {label}
          </p>
          <ul className="space-y-0.5">
            {items.map((s) => (
              <li key={s.id}>
                <SessionRow
                  session={s}
                  active={s.id === activeId}
                  onPick={() => onPick(s.id)}
                  onDelete={() => onDelete(s.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  session,
  active,
  onPick,
  onDelete,
}: {
  session: ChatSessionItem;
  active: boolean;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={[
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
        active
          ? "bg-ink-700/70 text-ink-100"
          : "text-ink-300 hover:bg-ink-800",
      ].join(" ")}
    >
      <MessageSquare className="h-3 w-3 flex-shrink-0 text-ink-400" />
      <button
        type="button"
        onClick={onPick}
        className="flex-1 truncate text-left"
        title={session.title}
      >
        {session.title}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        className="flex-shrink-0 rounded p-1 text-ink-500 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 sm:opacity-0 max-sm:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function groupByDate(sessions: ChatSessionItem[]) {
  const buckets = new Map<string, ChatSessionItem[]>();
  for (const s of sessions) {
    const d = new Date(s.updated_at);
    const label = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ ...s, _label: label } as ChatSessionItem & { _label: string });
  }
  return Array.from(buckets.values()).map((items) => ({
    label: (items[0] as ChatSessionItem & { _label: string })._label,
    items,
  }));
}
