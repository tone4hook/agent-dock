import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  TasksRepo,
  WorkflowRunsRepo,
  migrate,
} from "@agent-dock/db";
import { SessionsService } from "../src/services/sessions.js";

let db: Database.Database;
let service: SessionsService;
let sessions: SessionsRepo;
let tasks: TasksRepo;
let projects: ProjectsRepo;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  sessions = new SessionsRepo(db);
  tasks = new TasksRepo(db);
  projects = new ProjectsRepo(db);
  service = new SessionsService({
    db,
    pipelineSteps: new PipelineStepsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
  });
});

afterEach(() => db?.close());

function seed() {
  const p = projects.create({ rootPath: "/tmp/p", name: "alpha" });
  const t = tasks.create({ projectId: p.id, title: "task" });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const s = sessions.create({
      taskId: t.id,
      baseRef: "main",
      branch: `b${i}`,
      worktreePath: `/wt${i}`,
    });
    ids.push(s.id);
    if (i % 2 === 0) sessions.update(s.id, { status: "running" });
    if (i === 1) sessions.update(s.id, { status: "completed", endedAt: new Date().toISOString() });
    if (i === 3) sessions.update(s.id, { status: "failed", endedAt: new Date().toISOString() });
  }
  return { taskId: t.id, projectId: p.id, ids };
}

describe("SessionsService.list", () => {
  it("returns empty list on an empty workspace", () => {
    const r = service.list({ limit: 50, offset: 0 });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("returns all sessions ordered by createdAt DESC and joins task+project metadata", () => {
    const { ids } = seed();
    const r = service.list({ limit: 50, offset: 0 });
    expect(r.total).toBe(4);
    expect(new Set(r.items.map((i) => i.sessionId))).toEqual(new Set(ids));
    // createdAt values are SQLite CURRENT_TIMESTAMP (second resolution)
    // and may collide for same-batch inserts; only assert non-increasing.
    for (let i = 1; i < r.items.length; i++) {
      expect(r.items[i - 1].createdAt >= r.items[i].createdAt).toBe(true);
    }
    expect(r.items[0]).toMatchObject({
      taskTitle: "task",
      projectName: "alpha",
      branch: expect.stringMatching(/^b\d$/),
      baseRef: "main",
    });
  });

  it("filters by status", () => {
    seed();
    const running = service.list({ status: "running", limit: 50, offset: 0 });
    expect(running.total).toBe(2); // i=0 and i=2
    expect(running.items.every((i) => i.status === "running")).toBe(true);

    const completed = service.list({ status: "completed", limit: 50, offset: 0 });
    expect(completed.total).toBe(1);
    expect(completed.items[0].status).toBe("completed");

    const failed = service.list({ status: "failed", limit: 50, offset: 0 });
    expect(failed.total).toBe(1);
    expect(failed.items[0].status).toBe("failed");

    const draft = service.list({ status: "draft", limit: 50, offset: 0 });
    expect(draft.total).toBe(0); // every seed session was updated past draft
  });

  it("paginates via limit + offset", () => {
    seed();
    const page1 = service.list({ limit: 2, offset: 0 });
    expect(page1.total).toBe(4);
    expect(page1.items).toHaveLength(2);
    const page2 = service.list({ limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(2);
    const allIds = [...page1.items, ...page2.items].map((i) => i.sessionId);
    expect(new Set(allIds).size).toBe(4);
  });
});
