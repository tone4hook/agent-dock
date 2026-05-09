import * as React from "react";
import type { Project } from "@agent-dock/shared";
import { TopBar } from "@/components/TopBar";
import { ScopeChips } from "@/components/chat/ScopeChips";
import { ThreadListPanel } from "@/components/chat/ThreadListPanel";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { SaveAsNoteDialog } from "@/components/chat/SaveAsNoteDialog";
import { modelLabel } from "@/components/chat/ModelPicker";
import {
  chatEventStreamUrl,
  createChatThread,
  deleteChatThread,
  getChatThread,
  interruptChat,
  listChatThreads,
  sendChatMessage,
  updateChatThread,
  type ChatMessage,
  type ChatModel,
  type ChatScope,
  type ChatThread,
  type ReasoningEffort,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface ChatPageProps {
  threadId?: string;
  projects: Project[];
  workspaceDir: string | null;
  activeProjectId?: string | null;
  navigate: Navigate;
}

export function ChatPage({
  threadId,
  projects,
  workspaceDir,
  navigate,
}: ChatPageProps) {
  const [threads, setThreads] = React.useState<ChatThread[]>([]);
  const [thread, setThread] = React.useState<ChatThread | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveTarget, setSaveTarget] = React.useState<ChatMessage | null>(null);
  const esRef = React.useRef<EventSource | null>(null);
  const assistantIdRef = React.useRef<string | null>(null);

  // Resizable chat-list width. Persisted to localStorage so the choice
  // survives reloads. Constrained to keep both columns useful.
  const [listWidth, setListWidth] = React.useState<number>(() => {
    if (typeof window === "undefined") return 288;
    const saved = window.localStorage.getItem("ui-chat-list-width");
    const n = saved ? Number(saved) : NaN;
    return Number.isFinite(n) && n >= 200 && n <= 600 ? n : 288;
  });
  React.useEffect(() => {
    window.localStorage.setItem("ui-chat-list-width", String(listWidth));
  }, [listWidth]);
  const startResize = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = listWidth;
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(220, Math.min(560, startWidth + ev.clientX - startX));
        setListWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [listWidth],
  );

  const refreshThreads = React.useCallback(async () => {
    try {
      const list = await listChatThreads();
      setThreads(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // Load the active thread.
  React.useEffect(() => {
    if (!threadId) {
      setThread(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getChatThread(threadId);
        if (cancelled) return;
        setThread(r.thread);
        setMessages(r.messages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // SSE subscription, keyed on threadId. Each event reshapes `messages`.
  React.useEffect(() => {
    if (!threadId) return;
    const es = new EventSource(chatEventStreamUrl(threadId));
    esRef.current = es;
    const onEvent = (kind: string) => (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as { kind: string; payload: unknown };
        applyEvent(kind, parsed.payload);
      } catch {
        /* ignore malformed event */
      }
    };
    es.addEventListener("message_created", onEvent("message_created"));
    es.addEventListener("delta", onEvent("delta"));
    es.addEventListener("final", onEvent("final"));
    es.addEventListener("status", onEvent("status"));
    es.addEventListener("tool_use", onEvent("tool_use"));
    es.addEventListener("tool_result", onEvent("tool_result"));
    es.addEventListener("stderr", onEvent("stderr"));
    es.onerror = () => {
      // Silent — the runner's terminal status event will close the stream
      // logically; real network errors surface in `error`.
    };
    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function applyEvent(kind: string, payload: unknown) {
    if (kind === "message_created") {
      const msg = payload as ChatMessage;
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
      if (msg.role === "assistant") assistantIdRef.current = msg.id;
    } else if (kind === "delta") {
      const text = (payload as { text: string }).text;
      const id = assistantIdRef.current;
      if (!id) return;
      setMessages((cur) =>
        cur.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)),
      );
    } else if (kind === "final") {
      const text = (payload as { text: string }).text;
      const id = assistantIdRef.current;
      if (!id) return;
      setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, content: text } : m)));
    } else if (kind === "status") {
      const status = (payload as { status: string }).status;
      if (status === "running") setStreaming(true);
      else setStreaming(false);
    }
  }

  async function handleCreate() {
    try {
      const created = await createChatThread({
        title: "New chat",
        model: "claude-sonnet-4-6",
        reasoningEffort: "medium",
        scope: "general",
        scopeProjectId: null,
      });
      await refreshThreads();
      navigate({ view: "chat", threadId: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteChatThread(id);
      await refreshThreads();
      if (threadId === id) navigate({ view: "chat" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSend(text: string) {
    if (!threadId) return;
    try {
      setStreaming(true);
      const isFirstUserMessage = !messages.some((m) => m.role === "user");
      if (isFirstUserMessage && thread) {
        const trimmed = text.trim().replace(/\s+/g, " ");
        const derived = trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
        if (derived && derived !== thread.title) {
          try {
            const updated = await updateChatThread(thread.id, { title: derived });
            setThread(updated);
            void refreshThreads();
          } catch {
            /* non-fatal: title rename is best-effort */
          }
        }
      }
      await sendChatMessage(threadId, text);
    } catch (err) {
      setStreaming(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleInterrupt() {
    if (!threadId) return;
    try {
      await interruptChat(threadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRegenerate(message: ChatMessage) {
    if (!thread || streaming) return;
    // Regeneration UX v1: re-send the previous user message verbatim.
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx <= 0) return;
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    await handleSend(prevUser.content);
  }

  async function patchThread(patch: {
    model?: ChatModel;
    reasoningEffort?: ReasoningEffort;
    scope?: ChatScope;
    scopeProjectId?: string | null;
  }) {
    if (!thread) return;
    try {
      const updated = await updateChatThread(thread.id, patch);
      setThread(updated);
      await refreshThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openSaveAsNote(message: ChatMessage) {
    setSaveTarget(message);
    setSaveOpen(true);
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <ThreadListPanel
        threads={threads}
        activeId={threadId ?? null}
        onSelect={(id) => navigate({ view: "chat", threadId: id })}
        onCreate={() => void handleCreate()}
        onDelete={(id) => void handleDelete(id)}
        width={listWidth}
        onStartResize={startResize}
      />

      {!threadId || !thread ? (
        <div className="flex flex-1 flex-col">
          <TopBar title="Chat" sub="Pick a thread or start a new one" />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm text-muted-foreground">No chat selected.</p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Start a new chat
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={thread.title}
            sub={`${modelLabel(thread.model)}${
              thread.reasoningEffort ? ` · ${thread.reasoningEffort} reasoning` : ""
            } · ${thread.scope}`}
          />
          <ScopeChips
            scope={thread.scope}
            scopeProjectId={thread.scopeProjectId}
            projects={projects}
            workspaceDir={workspaceDir}
            disabled={streaming}
            onChange={(scope, projectId) =>
              void patchThread({ scope, scopeProjectId: projectId })
            }
          />
          {error && (
            <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-1 text-xs text-destructive">
              {error}
            </div>
          )}
          <MessageList
            messages={messages}
            streaming={streaming}
            onSaveAsNote={openSaveAsNote}
            onRegenerate={(m) => void handleRegenerate(m)}
          />
          <Composer
            model={thread.model}
            reasoningEffort={thread.reasoningEffort}
            busy={streaming}
            onModelChange={(m) => void patchThread({ model: m })}
            onEffortChange={(e) => void patchThread({ reasoningEffort: e })}
            onSubmit={(text) => void handleSend(text)}
            onInterrupt={() => void handleInterrupt()}
          />
        </div>
      )}

      <SaveAsNoteDialog
        open={saveOpen}
        message={saveTarget}
        projectId={thread?.scope === "project" ? thread.scopeProjectId : null}
        onClose={() => setSaveOpen(false)}
        onSaved={() => undefined}
      />
    </div>
  );
}
