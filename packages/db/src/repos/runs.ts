import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  AgentRunRecord,
  PermissionMode,
  RunStatus,
} from "@agent-dock/shared";

interface AgentRunRow {
  id: string;
  provider: AgentProvider;
  model_hint: string | null;
  reasoning_hint: string | null;
  permission_mode: PermissionMode;
  working_directory: string | null;
  prompt: string;
  status: RunStatus;
  final_text: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapAgentRun(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    provider: row.provider,
    modelHint: row.model_hint,
    reasoningHint: row.reasoning_hint,
    permissionMode: row.permission_mode,
    workingDirectory: row.working_directory,
    prompt: row.prompt,
    status: row.status,
    finalText: row.final_text,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateAgentRunRow {
  provider: AgentProvider;
  modelHint?: string | null;
  reasoningHint?: string | null;
  permissionMode: PermissionMode;
  workingDirectory?: string | null;
  prompt: string;
}

export class AgentRunsRepo {
  constructor(private readonly db: Database.Database) {}

  list(): AgentRunRecord[] {
    const rows = this.db.prepare("SELECT * FROM agent_runs ORDER BY created_at DESC").all() as AgentRunRow[];
    return rows.map(mapAgentRun);
  }

  get(id: string): AgentRunRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
    return row ? mapAgentRun(row) : null;
  }

  create(input: CreateAgentRunRow): AgentRunRecord {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO agent_runs (id, provider, model_hint, reasoning_hint, permission_mode, working_directory, prompt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
    `).run(
      id,
      input.provider,
      input.modelHint ?? null,
      input.reasoningHint ?? null,
      input.permissionMode,
      input.workingDirectory ?? null,
      input.prompt,
    );
    const created = this.get(id);
    if (!created) throw new Error("Failed to create run");
    return created;
  }

  updateStatus(
    id: string,
    status: RunStatus,
    patch: { finalText?: string | null; errorMessage?: string | null } = {},
  ): AgentRunRecord {
    this.db.prepare(`
      UPDATE agent_runs
      SET status = ?,
          final_text = COALESCE(?, final_text),
          error_message = COALESCE(?, error_message),
          started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
          completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled', 'timeout') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, patch.finalText ?? null, patch.errorMessage ?? null, status, status, id);
    const updated = this.get(id);
    if (!updated) throw new Error("Run not found");
    return updated;
  }
}
