import type Database from "better-sqlite3";
import type { PipelineStepsRepo, WorkflowRunsRepo } from "@agent-dock/db";
import type { Role, SessionStatus } from "@agent-dock/shared";

export interface SessionListItem {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  status: SessionStatus;
  branch: string;
  baseRef: string;
  currentStepRole: Role | null;
  currentStepOrd: number | null;
  totalSteps: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SessionListResult {
  items: SessionListItem[];
  total: number;
}

export interface SessionsServiceDeps {
  db: Database.Database;
  pipelineSteps: PipelineStepsRepo;
  workflowRuns: WorkflowRunsRepo;
}

export class SessionsService {
  constructor(private readonly deps: SessionsServiceDeps) {}

  /**
   * Workspace-wide session listing. Joins through tasks → projects so the
   * UI can render task title + project name without N+1 fetches. Filters
   * on status; paginates with limit/offset; ordered createdAt DESC.
   */
  list(opts: { status?: SessionStatus; limit: number; offset: number }): SessionListResult {
    interface Row {
      session_id: string;
      task_id: string;
      task_title: string;
      project_id: string;
      project_name: string;
      status: SessionStatus;
      branch: string;
      base_ref: string;
      current_step_id: string | null;
      created_at: string;
      updated_at: string;
      started_at: string | null;
      ended_at: string | null;
    }

    const where = opts.status ? "WHERE s.status = ?" : "";
    const params: unknown[] = [];
    if (opts.status) params.push(opts.status);

    const total = (
      this.deps.db
        .prepare(`SELECT COUNT(*) AS n FROM sessions s ${where}`)
        .get(...params) as { n: number }
    ).n;

    const rows = this.deps.db
      .prepare(
        `SELECT s.id AS session_id,
                s.task_id, t.title AS task_title,
                t.project_id, p.name AS project_name,
                s.status, s.branch, s.base_ref,
                s.current_step_id,
                s.created_at, s.updated_at, s.started_at, s.ended_at
           FROM sessions s
           JOIN tasks t ON t.id = s.task_id
           JOIN projects p ON p.id = t.project_id
           ${where}
          ORDER BY s.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, opts.limit, opts.offset) as Row[];

    const items: SessionListItem[] = rows.map((r) => {
      let currentStepRole: Role | null = null;
      let currentStepOrd: number | null = null;
      let totalSteps: number | null = null;
      if (r.current_step_id) {
        const step = this.deps.pipelineSteps.get(r.current_step_id);
        if (step) {
          currentStepRole = step.role;
          currentStepOrd = step.ord;
          totalSteps = this.deps.pipelineSteps.listForRun(step.runId).length;
        }
      } else {
        const runs = this.deps.workflowRuns.listForSession(r.session_id);
        const run = runs[runs.length - 1];
        if (run) totalSteps = this.deps.pipelineSteps.listForRun(run.id).length;
      }
      return {
        sessionId: r.session_id,
        taskId: r.task_id,
        taskTitle: r.task_title,
        projectId: r.project_id,
        projectName: r.project_name,
        status: r.status,
        branch: r.branch,
        baseRef: r.base_ref,
        currentStepRole,
        currentStepOrd,
        totalSteps,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      };
    });

    return { items, total };
  }
}
