import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskConfluenceLink,
  TaskJiraLink,
  TaskStatus,
} from "@agent-dock/shared";

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description_md: string;
  base_ref_override: string | null;
  status: TaskStatus;
  current_session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    descriptionMd: row.description_md,
    baseRefOverride: row.base_ref_override,
    status: row.status,
    currentSessionId: row.current_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTaskRow {
  projectId: string;
  title: string;
  descriptionMd?: string;
  baseRefOverride?: string | null;
}

export interface UpdateTaskRow {
  title?: string;
  descriptionMd?: string;
  baseRefOverride?: string | null;
  status?: TaskStatus;
  currentSessionId?: string | null;
}

export class TasksRepo {
  constructor(private readonly db: Database.Database) {}

  list(filter: { projectId?: string; status?: TaskStatus } = {}): Task[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      values.push(filter.projectId);
    }
    if (filter.status) {
      where.push("status = ?");
      values.push(filter.status);
    }
    const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
    return (this.db.prepare(sql).all(...values) as TaskRow[]).map(mapTask);
  }

  get(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  create(input: CreateTaskRow): Task {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, description_md, base_ref_override)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.descriptionMd ?? "",
        input.baseRefOverride ?? null,
      );
    const created = this.get(id);
    if (!created) throw new Error("Failed to create task");
    return created;
  }

  update(id: string, patch: UpdateTaskRow): Task {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.descriptionMd !== undefined) {
      sets.push("description_md = ?");
      values.push(patch.descriptionMd);
    }
    if (patch.baseRefOverride !== undefined) {
      sets.push("base_ref_override = ?");
      values.push(patch.baseRefOverride);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.currentSessionId !== undefined) {
      sets.push("current_session_id = ?");
      values.push(patch.currentSessionId);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Task not found");
    return updated;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}

interface TaskJiraLinkRow {
  task_id: string;
  jira_key: string;
  role: string;
  created_at: string;
}

interface TaskConfluenceLinkRow {
  task_id: string;
  page_id: string;
  role: string;
  created_at: string;
}

export class TaskLinksRepo {
  constructor(private readonly db: Database.Database) {}

  listJira(taskId: string): TaskJiraLink[] {
    return (
      this.db
        .prepare("SELECT * FROM task_jira_links WHERE task_id = ? ORDER BY created_at ASC")
        .all(taskId) as TaskJiraLinkRow[]
    ).map((r) => ({ taskId: r.task_id, jiraKey: r.jira_key, role: r.role, createdAt: r.created_at }));
  }

  addJira(input: { taskId: string; jiraKey: string; role?: string }): TaskJiraLink {
    this.db
      .prepare(
        `INSERT INTO task_jira_links (task_id, jira_key, role) VALUES (?, ?, ?)
         ON CONFLICT(task_id, jira_key) DO UPDATE SET role = excluded.role`,
      )
      .run(input.taskId, input.jiraKey, input.role ?? "");
    const row = this.db
      .prepare("SELECT * FROM task_jira_links WHERE task_id = ? AND jira_key = ?")
      .get(input.taskId, input.jiraKey) as TaskJiraLinkRow;
    return { taskId: row.task_id, jiraKey: row.jira_key, role: row.role, createdAt: row.created_at };
  }

  removeJira(taskId: string, jiraKey: string): void {
    this.db
      .prepare("DELETE FROM task_jira_links WHERE task_id = ? AND jira_key = ?")
      .run(taskId, jiraKey);
  }

  listConfluence(taskId: string): TaskConfluenceLink[] {
    return (
      this.db
        .prepare("SELECT * FROM task_confluence_links WHERE task_id = ? ORDER BY created_at ASC")
        .all(taskId) as TaskConfluenceLinkRow[]
    ).map((r) => ({ taskId: r.task_id, pageId: r.page_id, role: r.role, createdAt: r.created_at }));
  }

  addConfluence(input: { taskId: string; pageId: string; role?: string }): TaskConfluenceLink {
    this.db
      .prepare(
        `INSERT INTO task_confluence_links (task_id, page_id, role) VALUES (?, ?, ?)
         ON CONFLICT(task_id, page_id) DO UPDATE SET role = excluded.role`,
      )
      .run(input.taskId, input.pageId, input.role ?? "");
    const row = this.db
      .prepare("SELECT * FROM task_confluence_links WHERE task_id = ? AND page_id = ?")
      .get(input.taskId, input.pageId) as TaskConfluenceLinkRow;
    return { taskId: row.task_id, pageId: row.page_id, role: row.role, createdAt: row.created_at };
  }

  removeConfluence(taskId: string, pageId: string): void {
    this.db
      .prepare("DELETE FROM task_confluence_links WHERE task_id = ? AND page_id = ?")
      .run(taskId, pageId);
  }
}

// Convenience id generator export for callers that want to assign IDs upstream.
export function newTaskId(): string {
  return randomUUID();
}
