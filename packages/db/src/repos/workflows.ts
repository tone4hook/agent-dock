import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  PipelineStep,
  Role,
  Runner,
  StepStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from "@agent-dock/shared";

// --- WorkflowRuns ---

interface WorkflowRunRow {
  id: string;
  session_id: string;
  workflow_def_id: string;
  status: WorkflowRunStatus;
  created_at: string;
  updated_at: string;
}

function mapWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    workflowDefId: row.workflow_def_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateWorkflowRunRow {
  sessionId: string;
  workflowDefId?: string;
}

export class WorkflowRunsRepo {
  constructor(private readonly db: Database.Database) {}

  get(id: string): WorkflowRun | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as WorkflowRunRow | undefined;
    return row ? mapWorkflowRun(row) : null;
  }

  listForSession(sessionId: string): WorkflowRun[] {
    return (
      this.db
        .prepare("SELECT * FROM workflow_runs WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId) as WorkflowRunRow[]
    ).map(mapWorkflowRun);
  }

  create(input: CreateWorkflowRunRow): WorkflowRun {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workflow_runs (id, session_id, workflow_def_id)
         VALUES (?, ?, ?)`,
      )
      .run(id, input.sessionId, input.workflowDefId ?? "feature-flow");
    const created = this.get(id);
    if (!created) throw new Error("Failed to create workflow run");
    return created;
  }

  updateStatus(id: string, status: WorkflowRunStatus): WorkflowRun {
    this.db
      .prepare(`UPDATE workflow_runs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, id);
    const updated = this.get(id);
    if (!updated) throw new Error("WorkflowRun not found");
    return updated;
  }
}

// --- PipelineSteps ---

interface PipelineStepRow {
  id: string;
  run_id: string;
  ord: number;
  role: Role;
  runner: Runner;
  thread_id: string | null;
  status: StepStatus;
  started_at: string | null;
  ended_at: string | null;
  depends_on_json: string;
  created_at: string;
  updated_at: string;
}

function mapPipelineStep(row: PipelineStepRow): PipelineStep {
  let dependsOn: string[];
  try {
    const parsed = JSON.parse(row.depends_on_json) as unknown;
    dependsOn = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    dependsOn = [];
  }
  return {
    id: row.id,
    runId: row.run_id,
    ord: row.ord,
    role: row.role,
    runner: row.runner,
    threadId: row.thread_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    dependsOn,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreatePipelineStepRow {
  runId: string;
  ord: number;
  role: Role;
  runner?: Runner;
  dependsOn?: string[];
}

export interface UpdatePipelineStepRow {
  status?: StepStatus;
  threadId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export class PipelineStepsRepo {
  constructor(private readonly db: Database.Database) {}

  get(id: string): PipelineStep | null {
    const row = this.db
      .prepare("SELECT * FROM pipeline_steps WHERE id = ?")
      .get(id) as PipelineStepRow | undefined;
    return row ? mapPipelineStep(row) : null;
  }

  listForRun(runId: string): PipelineStep[] {
    return (
      this.db
        .prepare("SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY ord ASC")
        .all(runId) as PipelineStepRow[]
    ).map(mapPipelineStep);
  }

  create(input: CreatePipelineStepRow): PipelineStep {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO pipeline_steps (id, run_id, ord, role, runner, depends_on_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.ord,
        input.role,
        input.runner ?? "host",
        JSON.stringify(input.dependsOn ?? []),
      );
    const created = this.get(id);
    if (!created) throw new Error("Failed to create pipeline step");
    return created;
  }

  update(id: string, patch: UpdatePipelineStepRow): PipelineStep {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.threadId !== undefined) {
      sets.push("thread_id = ?");
      values.push(patch.threadId);
    }
    if (patch.startedAt !== undefined) {
      sets.push("started_at = ?");
      values.push(patch.startedAt);
    }
    if (patch.endedAt !== undefined) {
      sets.push("ended_at = ?");
      values.push(patch.endedAt);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE pipeline_steps SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("PipelineStep not found");
    return updated;
  }
}
