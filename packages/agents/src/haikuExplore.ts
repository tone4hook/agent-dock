import { CliExitError, createCoder } from "@tone4hook/headless-coding-agent-sdk";

export interface HaikuExploreInput {
  prompt: string;
  workingDirectory: string;
  signal?: AbortSignal;
  /** Called for every CoderStreamEvent (already typed in agents/types). */
  onEvent?: (event: { kind: "agent" | "stderr"; payload: unknown }) => void;
}

export interface HaikuExploreResult {
  status: "completed" | "failed" | "cancelled";
  markdown: string;
  errorMessage?: string;
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are agent-dock's read-only exploration assistant.

Your single output is one self-contained markdown brief that another
agent will read as context when planning a task. The brief goes
directly into a file the user will edit — there is no human
intermediary.

# Output rules — strict

- Your final assistant message must contain ONLY the markdown brief.
- Do NOT include any of: preamble ("I'll explore…"), tool-call
  narration ("Let me run…"), self-talk ("Now I should…"), summaries
  of what you just did, sign-offs, apologies, or todo lists.
- Do NOT call ExitPlanMode, TodoWrite, or any planning meta-tool.
- Do NOT write the brief to a file on disk. Return it as your reply.
- Use sections like \`## Summary\`, \`## Key files\`, \`## Conventions\`,
  \`## Risks\` when relevant. Cite files as \`path/to/file.ts:LINE\`.
- Be terse. The reader is another LLM with a limited context budget.

# Tool rules

- You are read-only. Use Read, Grep, Glob, and WebFetch only.
- Never modify files, run shell commands, or invoke tools beyond the
  read-only set.

Begin investigation immediately when given a prompt. End with the
brief and nothing else.`;

/**
 * Spawns a Claude Haiku thread in plan-mode with read-only tools and
 * streams events back through `onEvent`. Returns the final assembled
 * markdown along with a status.
 *
 * No DB persistence happens here — the coordinator buffers events
 * and the route layer surfaces them via SSE; persistence only occurs
 * when the user explicitly saves the result as a meta-context.
 */
export async function haikuExplore(input: HaikuExploreInput): Promise<HaikuExploreResult> {
  const ac = new AbortController();
  input.signal?.addEventListener("abort", () => ac.abort(), { once: true });

  let markdown = "";
  let status: HaikuExploreResult["status"] = "completed";
  let errorMessage: string | undefined;

  try {
    const coder = createCoder("claude", {
      model: HAIKU_MODEL,
      workingDirectory: input.workingDirectory,
      // bypass + tight allowedTools whitelist: read-only at the tool
      // layer, no permission prompts, no plan-mode meta-tooling
      // (TodoWrite / ExitPlanMode) which produce narration in output.
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Grep", "Glob", "WebFetch"],
      appendSystemPrompt: SYSTEM_PROMPT,
    });
    const thread = await coder.startThread();

    // Only the FINAL assistant turn is the brief. Intermediate turns
    // are chain-of-thought between tool uses and must be discarded.
    for await (const event of thread.runStreamed(input.prompt, { signal: ac.signal })) {
      if (event.type === "stderr") {
        input.onEvent?.({ kind: "stderr", payload: { line: event.line } });
        continue;
      }
      input.onEvent?.({ kind: "agent", payload: event });
      if (event.type === "message" && event.role === "assistant" && !event.delta && event.text) {
        markdown = event.text;
      }
    }
  } catch (err) {
    if (ac.signal.aborted) {
      status = "cancelled";
    } else {
      status = "failed";
      errorMessage =
        err instanceof CliExitError ? err.message : err instanceof Error ? err.message : String(err);
    }
  }

  return { status, markdown: markdown.trim(), errorMessage };
}
