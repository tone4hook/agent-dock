import { CliExitError, createCoder } from "@tone4hook/headless-coding-agent-sdk";
import type { ChatModel, ChatScope, ReasoningEffort } from "@agent-dock/shared";

export interface ChatRunnerThread {
  id: string;
  model: ChatModel;
  reasoningEffort: ReasoningEffort | null;
  scope: ChatScope;
  /**
   * Resolved working directory for the run. `null` when scope='general'
   * (no project context). For 'workspace' it's the workspace dir; for
   * 'project' it's the project root.
   */
  workingDirectory: string | null;
}

export type ChatStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool_use"; toolName: string; input?: unknown; toolId?: string }
  | { kind: "tool_result"; toolId?: string; output?: unknown; status?: string }
  | { kind: "stderr"; line: string }
  | { kind: "final"; text: string };

export interface ChatTurnResult {
  status: "completed" | "failed" | "cancelled";
  finalText: string;
  errorMessage?: string;
}

export interface RunChatTurnInput {
  thread: ChatRunnerThread;
  /** Composed user prompt for this turn. */
  userMessage: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

const SYSTEM_PROMPT = `You are agent-dock's chat assistant.

# Behaviour
- You have read-only filesystem access via Read/Grep/Glob plus WebFetch.
- NEVER edit, create, or delete files. NEVER run shell commands. If the
  user asks you to change something, explain the change in prose so they
  can apply it themselves or promote the conversation to a task.
- Be concise. The user can scroll back; long preambles waste their time.
- When you cite code, use \`path/to/file.ts:LINE\` format.`;

/**
 * One-shot chat turn against a Claude model. Bridges the headless SDK's
 * stream events into a coarse-grained ChatStreamEvent stream that the
 * coordinator persists + fans out via SSE.
 */
export async function runChatTurn(input: RunChatTurnInput): Promise<ChatTurnResult> {
  let finalText = "";
  let status: ChatTurnResult["status"] = "completed";
  let errorMessage: string | undefined;

  try {
    const coder = createCoder("claude", {
      model: input.thread.model,
      // workingDirectory is omitted for general scope so the SDK has no
      // implicit cwd — read tools without an explicit path will fail
      // rather than reaching into whatever the API process happened to
      // be started in.
      ...(input.thread.workingDirectory
        ? { workingDirectory: input.thread.workingDirectory }
        : {}),
      // Read-only by tool-layer scoping. Plan mode would surface
      // TodoWrite/ExitPlanMode narration (see Phase 7 finding) so we
      // pin bypassPermissions and let allowedTools enforce read-only.
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Grep", "Glob", "WebFetch"],
      appendSystemPrompt: SYSTEM_PROMPT,
    });
    const thread = await coder.startThread();

    for await (const event of thread.runStreamed(input.userMessage, {
      signal: input.signal,
    })) {
      if (event.type === "stderr") {
        input.onEvent({ kind: "stderr", line: event.line });
        continue;
      }
      if (event.type === "message" && event.role === "assistant" && event.text) {
        if (event.delta) {
          input.onEvent({ kind: "delta", text: event.text });
        } else {
          finalText = event.text;
          input.onEvent({ kind: "final", text: event.text });
        }
        continue;
      }
      if (event.type === "tool_use") {
        input.onEvent({
          kind: "tool_use",
          toolName: (event as { toolName?: string }).toolName ?? "tool",
          input: (event as { input?: unknown }).input,
          toolId: (event as { toolId?: string }).toolId,
        });
        continue;
      }
      if (event.type === "tool_result") {
        input.onEvent({
          kind: "tool_result",
          toolId: (event as { toolId?: string }).toolId,
          output: (event as { output?: unknown }).output,
          status: (event as { status?: string }).status,
        });
        continue;
      }
    }
  } catch (err) {
    if (input.signal.aborted) {
      status = "cancelled";
    } else {
      status = "failed";
      errorMessage =
        err instanceof CliExitError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    }
  }

  return { status, finalText: finalText.trim(), errorMessage };
}
