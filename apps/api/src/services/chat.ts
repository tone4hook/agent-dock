import type {
  ChatMessagesRepo,
  ChatThreadsRepo,
  ProjectsRepo,
} from "@agent-dock/db";
import {
  runChatTurn,
  type ChatStreamEvent,
  type ChatTurnResult,
  type RunChatTurnInput,
} from "@agent-dock/agents";
import type {
  ChatMessage,
  ChatScope,
  ChatThread,
  CreateChatThreadInput,
  UpdateChatThreadInput,
} from "@agent-dock/shared";

export interface ChatBusEvent {
  id: number;
  threadId: string;
  kind:
    | "message_created"
    | "delta"
    | "tool_use"
    | "tool_result"
    | "stderr"
    | "final"
    | "status";
  payload: unknown;
  createdAt: string;
}

type ChatRunFn = (input: RunChatTurnInput) => Promise<ChatTurnResult>;

export interface ChatServiceDeps {
  threads: ChatThreadsRepo;
  messages: ChatMessagesRepo;
  projects: ProjectsRepo;
  workspaceDir: () => string | null;
  /** Injectable for tests; defaults to the SDK runner. */
  runChatTurn?: ChatRunFn;
}

interface ActiveTurn {
  controller: AbortController;
  promise: Promise<void>;
  assistantMessageId: string;
}

type Listener = (event: ChatBusEvent) => void;

/**
 * Coordinates chat turns: persists user + assistant rows, fans out
 * stream events through an in-memory bus keyed by threadId, and
 * supports interrupt() via the AbortController held per active turn.
 */
export class ChatService {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly buffers = new Map<string, ChatBusEvent[]>();
  private nextEventId = 1;
  private readonly run: ChatRunFn;

  constructor(private readonly deps: ChatServiceDeps) {
    this.run = deps.runChatTurn ?? runChatTurn;
  }

  // ---------- Threads ----------

  listThreads(): ChatThread[] {
    return this.deps.threads.list();
  }

  getThread(id: string): ChatThread | null {
    return this.deps.threads.get(id);
  }

  createThread(input: CreateChatThreadInput): ChatThread {
    if (input.scope === "project") {
      const projectId = input.scopeProjectId;
      if (!projectId || !this.deps.projects.get(projectId)) {
        throw badRequest(`scopeProjectId ${projectId ?? "(none)"} not found`);
      }
    }
    return this.deps.threads.create({
      title: input.title,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      scope: input.scope,
      scopeProjectId: input.scope === "project" ? input.scopeProjectId ?? null : null,
    });
  }

  updateThread(id: string, patch: UpdateChatThreadInput): ChatThread {
    const existing = this.deps.threads.get(id);
    if (!existing) throw notFound("Chat thread not found");
    const merged = {
      scope: patch.scope ?? existing.scope,
      scopeProjectId:
        patch.scopeProjectId !== undefined ? patch.scopeProjectId : existing.scopeProjectId,
    };
    if (merged.scope === "project") {
      if (!merged.scopeProjectId || !this.deps.projects.get(merged.scopeProjectId)) {
        throw badRequest(`scopeProjectId ${merged.scopeProjectId ?? "(none)"} not found`);
      }
    }
    return this.deps.threads.update(id, {
      ...patch,
      // Force-clear scopeProjectId when scope leaves 'project'.
      scopeProjectId:
        patch.scope !== undefined && patch.scope !== "project"
          ? null
          : patch.scopeProjectId,
    });
  }

  async deleteThread(id: string): Promise<void> {
    await this.interrupt(id).catch(() => {});
    this.deps.messages.nullifyNoteRefsForThread(id);
    this.deps.threads.delete(id);
    this.listeners.delete(id);
    this.buffers.delete(id);
  }

  // ---------- Messages ----------

  listMessages(threadId: string): ChatMessage[] {
    return this.deps.messages.listForThread(threadId);
  }

  /**
   * Append a user message and kick off an assistant turn. Returns the
   * persisted user message + a placeholder assistant message id so the
   * client can stream into the right slot. Throws if the thread is
   * already mid-turn.
   */
  appendUserMessage(threadId: string, content: string): {
    userMessage: ChatMessage;
    assistantMessageId: string;
  } {
    const thread = this.deps.threads.get(threadId);
    if (!thread) throw notFound("Chat thread not found");
    if (this.active.has(threadId)) throw conflict("Thread is busy with an in-flight turn");

    const userMessage = this.deps.messages.append({
      threadId,
      role: "user",
      content,
    });
    this.publish(threadId, "message_created", userMessage);

    // Insert an empty assistant placeholder; we'll fill its content
    // when the runner finishes (or mark it failed/cancelled).
    const placeholder = this.deps.messages.append({
      threadId,
      role: "assistant",
      content: "",
      model: thread.model,
    });
    this.publish(threadId, "message_created", placeholder);

    const controller = new AbortController();
    const workingDirectory = this.resolveWorkingDirectory(thread.scope, thread.scopeProjectId);
    const promise = this.executeTurn(thread.id, content, workingDirectory, placeholder.id, controller);
    this.active.set(threadId, {
      controller,
      promise,
      assistantMessageId: placeholder.id,
    });
    return { userMessage, assistantMessageId: placeholder.id };
  }

  async interrupt(threadId: string): Promise<void> {
    const active = this.active.get(threadId);
    if (!active) return;
    active.controller.abort();
    await active.promise.catch(() => {});
  }

  // ---------- Subscriptions ----------

  subscribe(
    threadId: string,
    listener: Listener,
  ): { unsubscribe: () => void; replay: ChatBusEvent[] } | null {
    if (!this.deps.threads.get(threadId)) return null;
    const set = this.listeners.get(threadId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(threadId, set);
    return {
      replay: [...(this.buffers.get(threadId) ?? [])],
      unsubscribe: () => {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(threadId);
      },
    };
  }

  // ---------- Internals ----------

  private async executeTurn(
    threadId: string,
    userMessage: string,
    workingDirectory: string | null,
    assistantMessageId: string,
    controller: AbortController,
  ): Promise<void> {
    const thread = this.deps.threads.get(threadId);
    if (!thread) return;

    let assistantText = "";
    const toolUses: Array<{ toolName: string; input?: unknown; toolId?: string }> = [];

    this.publish(threadId, "status", { status: "running" });
    try {
      const result = await this.run({
        thread: {
          id: thread.id,
          model: thread.model,
          reasoningEffort: thread.reasoningEffort,
          scope: thread.scope,
          workingDirectory,
        },
        userMessage,
        signal: controller.signal,
        onEvent: (event: ChatStreamEvent) => {
          if (event.kind === "delta") {
            assistantText += event.text;
            this.publish(threadId, "delta", { text: event.text });
          } else if (event.kind === "final") {
            assistantText = event.text;
            this.publish(threadId, "final", { text: event.text });
          } else if (event.kind === "tool_use") {
            toolUses.push({ toolName: event.toolName, input: event.input, toolId: event.toolId });
            this.publish(threadId, "tool_use", event);
          } else if (event.kind === "tool_result") {
            this.publish(threadId, "tool_result", event);
          } else if (event.kind === "stderr") {
            this.publish(threadId, "stderr", { line: event.line });
          }
        },
      });

      const finalText = result.finalText.length > 0 ? result.finalText : assistantText;
      this.deps.messages.updateContent(assistantMessageId, {
        content:
          result.status === "completed"
            ? finalText
            : result.status === "cancelled"
              ? `${finalText}${finalText ? "\n\n" : ""}[interrupted]`
              : `${finalText}${finalText ? "\n\n" : ""}[error] ${result.errorMessage ?? "unknown"}`,
        toolUses: toolUses.length > 0 ? JSON.stringify(toolUses) : null,
      });
      this.deps.threads.touch(threadId);
      this.publish(threadId, "status", {
        status: result.status,
        errorMessage: result.errorMessage ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.messages.updateContent(assistantMessageId, {
        content: `[error] ${message}`,
      });
      this.publish(threadId, "status", { status: "failed", errorMessage: message });
    } finally {
      this.active.delete(threadId);
    }
  }

  private resolveWorkingDirectory(
    scope: ChatScope,
    scopeProjectId: string | null,
  ): string | null {
    if (scope === "general") return null;
    if (scope === "workspace") return this.deps.workspaceDir();
    if (scope === "project" && scopeProjectId) {
      return this.deps.projects.get(scopeProjectId)?.rootPath ?? null;
    }
    return null;
  }

  private publish(threadId: string, kind: ChatBusEvent["kind"], payload: unknown): void {
    const event: ChatBusEvent = {
      id: this.nextEventId++,
      threadId,
      kind,
      payload,
      createdAt: new Date().toISOString(),
    };
    const buf = this.buffers.get(threadId) ?? [];
    buf.push(event);
    // Cap per-thread buffer so long sessions don't grow unbounded.
    if (buf.length > 2000) buf.splice(0, buf.length - 2000);
    this.buffers.set(threadId, buf);
    for (const listener of this.listeners.get(threadId) ?? []) listener(event);
  }
}

function badRequest(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 400;
  return err;
}

function notFound(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 404;
  return err;
}

function conflict(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 409;
  return err;
}
