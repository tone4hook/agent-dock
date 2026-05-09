import { existsSync } from "node:fs";
import type {
  ProjectsRepo,
  SessionsRepo,
} from "@agent-dock/db";
import type { WorktreeManager } from "@agent-dock/worktrees";
import type { SessionStatus } from "@agent-dock/shared";

const ALL_STATUSES: SessionStatus[] = [
  "draft",
  "running",
  "awaiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

export interface ReconcileReport {
  staleSessions: Array<{ sessionId: string; reason: string }>;
  orphanWorktrees: Array<{ projectId: string; path: string; branch?: string }>;
}

export interface StartupServiceDeps {
  sessions: SessionsRepo;
  projects: ProjectsRepo;
  worktrees: WorktreeManager;
}

export class StartupService {
  private lastReport: ReconcileReport = { staleSessions: [], orphanWorktrees: [] };

  constructor(private readonly deps: StartupServiceDeps) {}

  /**
   * Mark sessions whose worktree has gone missing as `failed` (the API
   * crashed mid-run; the runner is gone, the dir was cleaned up). Then
   * cross-check `git worktree list` per project against the set of
   * paths the DB knows about and surface the diff as orphans for the
   * Maintenance UI.
   */
  async reconcile(): Promise<ReconcileReport> {
    const stale: ReconcileReport["staleSessions"] = [];
    const live = this.deps.sessions.listByStatus(["running", "paused", "awaiting_approval"]);
    const nowIso = new Date().toISOString();
    for (const s of live) {
      if (!s.worktreePath || s.worktreePath === "pending" || !existsSync(s.worktreePath)) {
        this.deps.sessions.update(s.id, {
          status: "failed",
          endedAt: nowIso,
        });
        stale.push({ sessionId: s.id, reason: "interrupted by shutdown" });
      }
    }

    // Orphan scan: for each project, ask git which worktrees exist on
    // disk and diff against the paths the DB knows about.
    const knownPaths = this.deps.sessions
      .listByStatus(ALL_STATUSES)
      .filter((s) => s.worktreePath && s.worktreePath !== "pending")
      .map((s) => s.worktreePath);

    const orphans: ReconcileReport["orphanWorktrees"] = [];
    for (const project of this.deps.projects.list()) {
      try {
        const report = await this.deps.worktrees.findOrphans({
          projectRoot: project.rootPath,
          knownPaths,
        });
        for (const w of report.onDiskOnly) {
          orphans.push({ projectId: project.id, path: w.path, branch: w.branch ?? undefined });
        }
      } catch {
        // Project root may not be a git repo right now — skip.
      }
    }

    this.lastReport = { staleSessions: stale, orphanWorktrees: orphans };
    return this.lastReport;
  }

  getLastReport(): ReconcileReport {
    return this.lastReport;
  }
}
