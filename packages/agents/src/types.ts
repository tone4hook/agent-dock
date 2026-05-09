import type { CoderStreamEvent, SharedStartOpts } from "@tone4hook/headless-coding-agent-sdk";
import type { AgentProvider, PermissionMode } from "@agent-dock/shared";

export interface AgentRunnerEvent {
  type: "agent" | "stderr";
  provider: AgentProvider;
  event?: CoderStreamEvent;
  line?: string;
}

export interface AgentRunInput {
  provider: AgentProvider;
  prompt: string;
  workingDirectory?: string | null;
  modelHint?: string | null;
  reasoningHint?: string | null;
  permissionMode: PermissionMode;
  signal?: AbortSignal;
  onEvent?: (event: AgentRunnerEvent) => void;
}

export interface AgentRunResult {
  status: "completed" | "failed" | "cancelled" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorMessage?: string | null;
}

export type StartOpts = SharedStartOpts & Record<string, unknown>;

export interface ProviderAdapter {
  id: AgentProvider;
  buildStartOpts(input: AgentRunInput): StartOpts;
}
