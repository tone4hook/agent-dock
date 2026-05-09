import { z } from "zod";

export const agentProviderValues = ["claude", "gemini", "codex"] as const;
export const permissionModeValues = ["default", "plan", "accept-edits", "bypass"] as const;
export const runStatusValues = ["queued", "running", "completed", "failed", "cancelled", "timeout"] as const;

export type AgentProvider = (typeof agentProviderValues)[number];
export type PermissionMode = (typeof permissionModeValues)[number];
export type RunStatus = (typeof runStatusValues)[number];

export interface AgentRunRecord {
  id: string;
  provider: AgentProvider;
  modelHint: string | null;
  reasoningHint: string | null;
  permissionMode: PermissionMode;
  workingDirectory: string | null;
  prompt: string;
  status: RunStatus;
  finalText: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunEventRecord {
  id: number;
  runId: string;
  eventType: string;
  provider: AgentProvider | null;
  payloadJson: string;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  artifactType: "stdout" | "stderr" | "final_text" | string;
  title: string;
  filePath: string;
  preview: string | null;
  createdAt: string;
}

export const runtimeSettingsSchema = z.object({
  defaultProvider: z.enum(agentProviderValues).default("claude"),
  defaultModelHint: z.string().trim().nullable().default(null),
  defaultReasoningHint: z.string().trim().nullable().default(null),
  defaultWorkingDirectory: z.string().trim().nullable().default(null),
  defaultPermissionMode: z.enum(permissionModeValues).default("bypass"),
  workspaceDir: z.string().trim().min(1).nullable().default(null),
  maxConcurrentSessions: z.number().int().min(1).max(6).default(3),
  welcomeDismissed: z.boolean().default(false),
});

export const createAgentRunSchema = z.object({
  provider: z.enum(agentProviderValues).default("claude"),
  prompt: z.string().min(1),
  workingDirectory: z.string().trim().optional(),
  modelHint: z.string().trim().optional(),
  reasoningHint: z.string().trim().optional(),
  permissionMode: z.enum(permissionModeValues).default("bypass"),
});

export type RuntimeSettingsRecord = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeSettingsInput = z.input<typeof runtimeSettingsSchema>;
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;

export * from "./domain.js";
