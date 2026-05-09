import { CliExitError, createCoder } from "@tone4hook/headless-coding-agent-sdk";

// Locally-declared subset of the workflows package's RoleDef. We avoid
// a direct dep on @agent-dock/workflows here so the dep graph stays
// agents → sdk and orchestrator → agents/workflows (no cycle).
export interface StepRunnerRoleDef {
  role: string;
  model: string;
  reasoningHint?: string;
  permissionMode: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  allowedTools: string[];
  systemPromptBuilder: (pack: { markdown: string }) => string;
  outputSchema?: Record<string, unknown>;
}

export interface StepRunnerInput {
  role: StepRunnerRoleDef;
  /** Absolute path of the session worktree (cwd for the SDK). */
  workingDirectory: string;
  /** Rendered ContextPack markdown. The role builder wraps this with role rules. */
  prompt: string;
  signal: AbortSignal;
  onEvent: (event: StepRunnerEvent) => void;
  /**
   * Resume an existing thread by id (Claude only). When set, the runner
   * uses `coder.resumeThread(id)` instead of starting a fresh thread —
   * used by the coordinator's pause→resume path so the agent picks up
   * where it left off.
   */
  resumeThreadId?: string | null;
  /**
   * Fired as soon as the thread id is known (just after start/resume),
   * before any await on the run iterator. Lets the caller persist the
   * id immediately so a crash mid-run doesn't lose it.
   */
  onThreadId?: (threadId: string) => void;
}

export type StepRunnerEvent =
  | { kind: "agent"; payload: unknown }
  | { kind: "stderr"; payload: { line: string } };

export interface StepRunnerResult {
  status: "completed" | "failed" | "cancelled";
  threadId: string | null;
  finalText: string;
  /** Structured JSON from outputSchema (code-review only). */
  json?: unknown;
  errorMessage?: string;
}

export interface StepRunner {
  run(input: StepRunnerInput): Promise<StepRunnerResult>;
}

/**
 * Headless Claude Code (`claude` CLI) emits structured-output as a
 * synthetic tool_use event when `--json-schema` is set. The tool name
 * has historically been `StructuredOutput`; this matcher is lenient
 * (case-insensitive substring) so a CLI rename can't quietly regress.
 *
 * Exported for unit-test coverage from the orchestrator workspace.
 */
export function isStructuredOutputToolName(name: string): boolean {
  return /structuredoutput/i.test(name);
}

/**
 * Headless Claude has surfaced structured output in more than one
 * streamed shape over time:
 *   - a synthetic StructuredOutput tool_use with payload in `args`
 *   - the final result/done event under `originalItem.structured_output`
 *
 * Keep this extractor broad and side-effect-free so the runner can
 * survive SDK event-shape drift without losing the JSON plan.
 */
export function structuredOutputFromEvent(event: unknown): unknown {
  const root = asRecord(event);
  if (!root) return undefined;

  const direct = own(root, "structured_output");
  if (direct.found) return direct.value;
  const directCamel = own(root, "structuredOutput");
  if (directCamel.found) return directCamel.value;

  const originalItem = asRecord(root.originalItem);
  if (originalItem) {
    const original = own(originalItem, "structured_output");
    if (original.found) return original.value;
    const originalCamel = own(originalItem, "structuredOutput");
    if (originalCamel.found) return originalCamel.value;
  }

  const extra = asRecord(root.extra);
  if (extra) {
    const extraDirect = own(extra, "structured_output");
    if (extraDirect.found) return extraDirect.value;
    const extraCamel = own(extra, "structuredOutput");
    if (extraCamel.found) return extraCamel.value;

    const extraOriginalItem = asRecord(extra.originalItem);
    if (extraOriginalItem) {
      const extraOriginal = own(extraOriginalItem, "structured_output");
      if (extraOriginal.found) return extraOriginal.value;
      const extraOriginalCamel = own(extraOriginalItem, "structuredOutput");
      if (extraOriginalCamel.found) return extraOriginalCamel.value;
    }
  }

  return undefined;
}

/**
 * Pure helper — given the captured tool-args JSON (`toolJson`) and the
 * accumulated final assistant text (`finalText`) from a streamed run,
 * decide what `result.json` should be. Returns either the decoded
 * value, or a typed failure that the caller maps to status="failed".
 *
 * Behavior:
 *  - tool-args present     → use it directly (canonical path).
 *  - text non-empty + parseable → use it (older Claude / non-tool path).
 *  - text non-empty + unparseable → failure ("non-JSON final text").
 *  - neither               → failure ("no structured output").
 *
 * Pure, side-effect-free; unit-testable without spinning up the CLI.
 */
export function extractStructuredOutput(
  toolJson: unknown,
  finalText: string,
):
  | { ok: true; json: unknown }
  | { ok: false; errorMessage: string } {
  if (toolJson !== undefined) return { ok: true, json: toolJson };
  if (finalText.trim().length > 0) {
    try {
      return { ok: true, json: JSON.parse(finalText) };
    } catch {
      return {
        ok: false,
        errorMessage: "outputSchema role returned non-JSON final text",
      };
    }
  }
  return {
    ok: false,
    errorMessage:
      "outputSchema role produced no structured output (no StructuredOutput tool_use and no final text)",
  };
}

export function errorMessageFromEvent(event: unknown): string | undefined {
  const root = asRecord(event);
  if (!root || root.type !== "error") return undefined;
  const message = root.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }
  const code = root.code;
  if (typeof code === "string" && code.trim().length > 0) return code;
  return "Claude reported an error";
}

/**
 * Production runner — spawns a headless Claude Code (`claude` CLI)
 * thread via the @tone4hook/headless-coding-agent-sdk wrapper, with
 * the role's model/permission/tools/systemPrompt/outputSchema. Tests
 * inject a mock implementation of `StepRunner` instead.
 */
export class SdkStepRunner implements StepRunner {
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    let finalText = "";
    let threadId: string | null = null;
    let status: StepRunnerResult["status"] = "completed";
    let errorMessage: string | undefined;
    // Captured from any tool_use event whose name matches Claude's
    // outputSchema tool ("StructuredOutput"). When --json-schema is on,
    // modern Claude uses this tool to emit the structured JSON; the
    // canonical payload lives in `event.args`, NOT in any assistant
    // message text. The SDK's `run()` helper has the same blind spot
    // (it parses accumulated text only), so we capture here ourselves.
    let toolJson: unknown;

    try {
      const coder = createCoder("claude", {
        model: input.role.model,
        workingDirectory: input.workingDirectory,
        permissionMode: input.role.permissionMode,
        allowedTools: input.role.allowedTools,
        appendSystemPrompt: input.role.systemPromptBuilder({
          markdown: input.prompt,
        }),
      });
      const thread = input.resumeThreadId
        ? await coder.resumeThread(input.resumeThreadId)
        : await coder.startThread();
      threadId = thread.id ?? null;
      if (threadId && input.onThreadId) input.onThreadId(threadId);

      const runOpts: Record<string, unknown> = { signal: input.signal };
      if (input.role.outputSchema) runOpts.outputSchema = input.role.outputSchema;

      // The user prompt is minimal — the role's appendSystemPrompt
      // carries the full ContextPack and the role rules.
      const kickoff = `Run as the ${input.role.role} role per your system prompt.`;

      for await (const event of thread.runStreamed(kickoff, runOpts)) {
        if (event.type === "stderr") {
          input.onEvent({ kind: "stderr", payload: { line: event.line } });
          continue;
        }
        input.onEvent({ kind: "agent", payload: event });
        const streamedError = errorMessageFromEvent(event);
        if (streamedError) {
          status = "failed";
          errorMessage = streamedError;
        }
        if (
          event.type === "message" &&
          event.role === "assistant" &&
          !event.delta &&
          event.text
        ) {
          finalText = event.text;
        }
        if (
          event.type === "tool_use" &&
          typeof event.name === "string" &&
          isStructuredOutputToolName(event.name) &&
          input.role.outputSchema
        ) {
          // Claude's --json-schema mode surfaces the structured payload
          // as the args of a synthetic StructuredOutput tool call. Last
          // one wins (defensive — there should only be one per run).
          toolJson = event.args;
        }
        if (input.role.outputSchema) {
          const resultJson = structuredOutputFromEvent(event);
          if (resultJson !== undefined) {
            // Some SDK versions only attach the validated payload to
            // the final result/done event. Treat that as equivalent to
            // the StructuredOutput tool args.
            toolJson = resultJson;
          }
        }
      }

      if (input.role.outputSchema) {
        if (status !== "completed") {
          return { status, threadId, finalText, errorMessage };
        }
        const extracted = extractStructuredOutput(toolJson, finalText);
        if (!extracted.ok) {
          status = "failed";
          errorMessage = extracted.errorMessage;
          return { status, threadId, finalText, errorMessage };
        }
        return { status, threadId, finalText, json: extracted.json };
      }
      return { status, threadId, finalText };
    } catch (err) {
      if (input.signal.aborted) {
        status = "cancelled";
      } else {
        status = "failed";
        const caughtMessage =
          err instanceof CliExitError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        errorMessage =
          errorMessage && caughtMessage && !errorMessage.includes(caughtMessage)
            ? `${errorMessage}\n${caughtMessage}`
            : errorMessage || caughtMessage;
      }
      return { status, threadId, finalText, errorMessage };
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function own(
  value: Record<string, unknown>,
  key: string,
): { found: true; value: unknown } | { found: false } {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? { found: true, value: value[key] }
    : { found: false };
}
