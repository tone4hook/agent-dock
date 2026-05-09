import type Database from "better-sqlite3";
import type {
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  TasksRepo,
  WorkflowRunsRepo,
} from "@agent-dock/db";
import type { Role, SessionStatus } from "@agent-dock/shared";

export interface DashboardRunningSession {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  status: SessionStatus;
  currentStepRole: Role | null;
  currentStepOrd: number | null;
  totalSteps: number | null;
}

export interface DashboardProject {
  id: string;
  name: string;
  defaultBaseRef: string;
  openTasks: number;
  activeSessions: number;
}

export interface DashboardActivity {
  ts: string;
  kind:
    | "task_created"
    | "session_started"
    | "session_completed"
    | "session_failed"
    | "session_cancelled"
    | "session_paused"
    | "step_completed"
    | "step_started"
    | "review_passed"
    | "review_failed"
    | "plan_updated"
    | "haiku_saved";
  title: string;
  sub: string;
  severity: "info" | "warn" | "bad" | "ok";
}

export interface DashboardSummary {
  activeSessions: number;
  awaitingApproval: number;
  /**
   * Subset of `awaitingApproval` whose latest `review_result` step_artifact
   * had `passed=false`. Used by the UI to distinguish "fresh plan needs
   * approval" (informational) from "code review failed, please re-plan"
   * (warning).
   */
  reviewFailed: number;
  openTasks: number;
  notesCount: number;
  runningSessions: DashboardRunningSession[];
  projects: DashboardProject[];
  recentActivity: DashboardActivity[];
}

export interface DashboardServiceDeps {
  db: Database.Database;
  sessions: SessionsRepo;
  tasks: TasksRepo;
  projects: ProjectsRepo;
  pipelineSteps: PipelineStepsRepo;
  workflowRuns: WorkflowRunsRepo;
}

const ACTIVITY_LIMIT = 25;

export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  summary(): DashboardSummary {
    const { db } = this.deps;

    const activeSessions = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sessions WHERE status IN ('running','paused')`,
        )
        .get() as { n: number }
    ).n;

    const awaitingApproval = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE status = 'awaiting_approval'`)
        .get() as { n: number }
    ).n;

    // A session is "review-failed" when it's awaiting_approval AND the
    // latest review_result artifact under it carries passed=false in its
    // preview JSON. The preview is the JSON.stringify(verdict) Phase 14
    // persisted, so a literal substring check is sufficient and avoids
    // pulling SQLite's JSON1 extension into the dependency surface.
    const reviewFailed = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT s.id) AS n
             FROM sessions s
             JOIN workflow_runs r ON r.session_id = s.id
             JOIN pipeline_steps p ON p.run_id = r.id
             JOIN step_artifacts a ON a.step_id = p.id
            WHERE s.status = 'awaiting_approval'
              AND a.kind = 'review_result'
              AND a.preview LIKE '%"passed":false%'`,
        )
        .get() as { n: number }
    ).n;

    const openTasks = (
      db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'`).get() as {
        n: number;
      }
    ).n;

    const notesCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM notes`).get() as { n: number }
    ).n;

    const runningSessions = this.listRunningSessions();
    const projects = this.listProjectAggregate();
    const recentActivity = this.listRecentActivity();

    return {
      activeSessions,
      awaitingApproval,
      reviewFailed,
      openTasks,
      notesCount,
      runningSessions,
      projects,
      recentActivity,
    };
  }

  private listRunningSessions(): DashboardRunningSession[] {
    interface Row {
      session_id: string;
      session_status: SessionStatus;
      current_step_id: string | null;
      task_id: string;
      task_title: string;
      project_id: string;
      project_name: string;
    }
    const rows = this.deps.db
      .prepare(
        `SELECT s.id AS session_id, s.status AS session_status,
                s.current_step_id AS current_step_id,
                t.id AS task_id, t.title AS task_title,
                p.id AS project_id, p.name AS project_name
           FROM sessions s
           JOIN tasks t ON t.id = s.task_id
           JOIN projects p ON p.id = t.project_id
          WHERE s.status IN ('running','paused','awaiting_approval')
          ORDER BY s.created_at DESC`,
      )
      .all() as Row[];

    return rows.map((r) => {
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
        status: r.session_status,
        taskId: r.task_id,
        taskTitle: r.task_title,
        projectId: r.project_id,
        projectName: r.project_name,
        currentStepRole,
        currentStepOrd,
        totalSteps,
      };
    });
  }

  private listProjectAggregate(): DashboardProject[] {
    interface Row {
      id: string;
      name: string;
      default_base_ref: string;
      open_tasks: number;
      active_sessions: number;
    }
    const rows = this.deps.db
      .prepare(
        `SELECT p.id, p.name, p.default_base_ref,
                (SELECT COUNT(*) FROM tasks t
                  WHERE t.project_id = p.id AND t.status = 'open') AS open_tasks,
                (SELECT COUNT(*) FROM sessions s
                   JOIN tasks t ON t.id = s.task_id
                  WHERE t.project_id = p.id
                    AND s.status IN ('running','awaiting_approval','paused')) AS active_sessions
           FROM projects p
          WHERE p.archived_at IS NULL
          ORDER BY p.name COLLATE NOCASE ASC`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      defaultBaseRef: r.default_base_ref,
      openTasks: r.open_tasks,
      activeSessions: r.active_sessions,
    }));
  }

  /**
   * Merges three sources into a single most-recent-first activity feed:
   *   - tasks: created / status-updated rows
   *   - sessions: status transitions (created_at = started; ended_at = terminal)
   *   - step_events: kinds that map to user-meaningful surfaces
   * Capped at ACTIVITY_LIMIT.
   */
  private listRecentActivity(): DashboardActivity[] {
    interface SessionRow {
      id: string;
      task_id: string;
      task_title: string;
      project_name: string;
      status: SessionStatus;
      created_at: string;
      ended_at: string | null;
    }
    interface TaskRow {
      id: string;
      title: string;
      project_name: string;
      created_at: string;
    }
    interface StepEventRow {
      kind: string;
      created_at: string;
      session_id: string;
      task_title: string;
      project_name: string;
    }

    const sessionRows = this.deps.db
      .prepare(
        `SELECT s.id, s.task_id, t.title AS task_title, p.name AS project_name,
                s.status, s.created_at, s.ended_at
           FROM sessions s
           JOIN tasks t ON t.id = s.task_id
           JOIN projects p ON p.id = t.project_id
          ORDER BY COALESCE(s.ended_at, s.created_at) DESC
          LIMIT ?`,
      )
      .all(ACTIVITY_LIMIT) as SessionRow[];

    const taskRows = this.deps.db
      .prepare(
        `SELECT t.id, t.title, p.name AS project_name, t.created_at
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          ORDER BY t.created_at DESC
          LIMIT ?`,
      )
      .all(ACTIVITY_LIMIT) as TaskRow[];

    const stepEventRows = this.deps.db
      .prepare(
        `SELECT se.kind, se.created_at, wr.session_id AS session_id,
                t.title AS task_title, p.name AS project_name
           FROM step_events se
           JOIN pipeline_steps ps ON ps.id = se.step_id
           JOIN workflow_runs wr ON wr.id = ps.run_id
           JOIN sessions s ON s.id = wr.session_id
           JOIN tasks t ON t.id = s.task_id
           JOIN projects p ON p.id = t.project_id
          WHERE se.kind IN ('plan_updated','review_result','findings_updated')
          ORDER BY se.created_at DESC
          LIMIT ?`,
      )
      .all(ACTIVITY_LIMIT) as StepEventRow[];

    const items: DashboardActivity[] = [];

    for (const r of sessionRows) {
      // Started
      items.push({
        ts: r.created_at,
        kind: "session_started",
        title: "Session started",
        sub: `${r.task_title} · ${r.project_name}`,
        severity: "info",
      });
      if (r.ended_at) {
        const kind: DashboardActivity["kind"] =
          r.status === "completed"
            ? "session_completed"
            : r.status === "failed"
              ? "session_failed"
              : r.status === "cancelled"
                ? "session_cancelled"
                : "session_started";
        const severity: DashboardActivity["severity"] =
          r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "info";
        items.push({
          ts: r.ended_at,
          kind,
          title:
            r.status === "completed"
              ? "Session completed"
              : r.status === "failed"
                ? "Session failed"
                : r.status === "cancelled"
                  ? "Session cancelled"
                  : "Session ended",
          sub: `${r.task_title} · ${r.project_name}`,
          severity,
        });
      }
    }

    for (const r of taskRows) {
      items.push({
        ts: r.created_at,
        kind: "task_created",
        title: "Task created",
        sub: `${r.title} · ${r.project_name}`,
        severity: "info",
      });
    }

    for (const r of stepEventRows) {
      const mapping: Record<string, { kind: DashboardActivity["kind"]; title: string; severity: DashboardActivity["severity"] }> = {
        plan_updated: { kind: "plan_updated", title: "Plan updated", severity: "info" },
        review_result: { kind: "review_passed", title: "Code review", severity: "ok" },
        findings_updated: { kind: "step_completed", title: "Findings updated", severity: "info" },
      };
      const m = mapping[r.kind];
      if (!m) continue;
      items.push({
        ts: r.created_at,
        kind: m.kind,
        title: m.title,
        sub: `${r.task_title} · ${r.project_name}`,
        severity: m.severity,
      });
    }

    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return items.slice(0, ACTIVITY_LIMIT);
  }
}
