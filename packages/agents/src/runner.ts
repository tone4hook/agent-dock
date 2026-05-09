import * as hcaSdk from "@tone4hook/headless-coding-agent-sdk";
import {
  CliExitError,
  createCoder,
  type HeadlessCoder,
} from "@tone4hook/headless-coding-agent-sdk";
import type { AgentProvider } from "@agent-dock/shared";
import { getProviderAdapter } from "./providers/index.js";
import type { AgentRunInput, AgentRunResult, StartOpts } from "./types.js";

export async function shutdownSpawnedClis(reason?: string): Promise<void> {
  await (hcaSdk as { shutdownSpawnedClis?: (reason?: string) => Promise<void> }).shutdownSpawnedClis?.(reason);
}

export class SdkAgentRunner {
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const ac = new AbortController();
    input.signal?.addEventListener("abort", () => ac.abort(), { once: true });

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = 0;
    let status: AgentRunResult["status"] = "completed";
    let errorMessage: string | null = null;

    try {
      const adapter = getProviderAdapter(input.provider);
      const createAnyCoder = createCoder as unknown as (
        provider: AgentProvider,
        defaults?: StartOpts,
      ) => HeadlessCoder;
      const coder = createAnyCoder(input.provider, adapter.buildStartOpts(input));
      const thread = await coder.startThread();
      for await (const event of thread.runStreamed(input.prompt, { signal: ac.signal })) {
        if (event.type === "stderr") {
          stderr += `${event.line}\n`;
          input.onEvent?.({ type: "stderr", provider: input.provider, event, line: event.line });
          continue;
        }
        input.onEvent?.({ type: "agent", provider: input.provider, event });
        if (event.type === "message" && event.role === "assistant" && !event.delta && event.text) {
          stdout += event.text;
        }
      }
    } catch (err) {
      if (ac.signal.aborted) {
        status = "cancelled";
        exitCode = null;
      } else if (err instanceof CliExitError) {
        status = "failed";
        exitCode = err.exitCode;
        stderr = stderr ? `${stderr}\n${err.stderr}` : err.stderr;
        errorMessage = err.message;
      } else {
        status = "failed";
        exitCode = 1;
        errorMessage = err instanceof Error ? err.message : String(err);
        stderr = stderr ? `${stderr}\n${errorMessage}` : errorMessage;
      }
    }

    return {
      status,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      errorMessage,
    };
  }
}
