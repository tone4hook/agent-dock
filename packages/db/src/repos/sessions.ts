import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Session, SessionStatus } from "@agent-dock/shared";

interface SessionRow {
  id: string;
  task_id: string;
  base_ref: string;
  branch: string;
  worktree_path: string;
  status: SessionStatus;
  current_step_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    taskId: row.task_id,
    baseRef: row.base_ref,
    branch: row.branch,
    worktreePath: row.worktree_path,
    status: row.status,
    currentStepId: row.current_step_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSessionRow {
  taskId: string;
  baseRef: string;
  branch: string;
  worktreePath: string;
}

export interface UpdateSessionRow {
  status?: SessionStatus;
  currentStepId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export class SessionsRepo {
  constructor(private readonly db: Database.Database) {}

  listForTask(taskId: string): Session[] {
    return (
      this.db
        .prepare("SELECT * FROM sessions WHERE task_id = ? ORDER BY created_at DESC")
        .all(taskId) as SessionRow[]
    ).map(mapSession);
  }

  listByStatus(statuses: SessionStatus[]): Session[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(",");
    return (
      this.db
        .prepare(`SELECT * FROM sessions WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
        .all(...statuses) as SessionRow[]
    ).map(mapSession);
  }

  countActive(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM sessions
         WHERE status IN ('running','awaiting_approval','paused')`,
      )
      .get() as { n: number };
    return row.n;
  }

  get(id: string): Session | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  create(input: CreateSessionRow): Session {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO sessions (id, task_id, base_ref, branch, worktree_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.baseRef, input.branch, input.worktreePath);
    const created = this.get(id);
    if (!created) throw new Error("Failed to create session");
    return created;
  }

  update(id: string, patch: UpdateSessionRow): Session {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.currentStepId !== undefined) {
      sets.push("current_step_id = ?");
      values.push(patch.currentStepId);
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
      this.db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Session not found");
    return updated;
  }

  /**
   * Update the set-once metadata columns. Called once after worktree
   * creation to write the canonical worktree_path/branch/baseRef onto
   * a session row that was created with placeholder values.
   */
  setMeta(
    id: string,
    meta: { worktreePath: string; branch: string; baseRef: string },
  ): Session {
    this.db
      .prepare(
        `UPDATE sessions
         SET worktree_path = ?, branch = ?, base_ref = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(meta.worktreePath, meta.branch, meta.baseRef, id);
    const updated = this.get(id);
    if (!updated) throw new Error("Session not found");
    return updated;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
