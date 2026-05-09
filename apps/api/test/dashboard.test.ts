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
import { DashboardService } from "../src/services/dashboard.js";

let db: Database.Database;
let service: DashboardService;
let repos: {
  sessions: SessionsRepo;
  tasks: TasksRepo;
  projects: ProjectsRepo;
  pipelineSteps: PipelineStepsRepo;
  workflowRuns: WorkflowRunsRepo;
};

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  repos = {
    sessions: new SessionsRepo(db),
    tasks: new TasksRepo(db),
    projects: new ProjectsRepo(db),
    pipelineSteps: new PipelineStepsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
  };
  service = new DashboardService({ db, ...repos });
});

afterEach(() => db?.close());

describe("DashboardService.summary", () => {
  it("reports zeroed counts on an empty workspace", () => {
    const s = service.summary();
    expect(s.activeSessions).toBe(0);
    expect(s.awaitingApproval).toBe(0);
    expect(s.openTasks).toBe(0);
    expect(s.notesCount).toBe(0);
    expect(s.runningSessions).toEqual([]);
    expect(s.projects).toEqual([]);
    expect(s.recentActivity).toEqual([]);
  });

  it("aggregates counts and project rollups across two projects", () => {
    const p1 = repos.projects.create({ rootPath: "/tmp/p1", name: "alpha" });
    const p2 = repos.projects.create({ rootPath: "/tmp/p2", name: "beta" });
    const t1 = repos.tasks.create({ projectId: p1.id, title: "task-1" });
    const t2 = repos.tasks.create({ projectId: p1.id, title: "task-2" });
    repos.tasks.create({ projectId: p2.id, title: "task-3" });
    repos.tasks.update(t2.id, { status: "in_progress" });

    repos.sessions.create({
      taskId: t1.id,
      baseRef: "main",
      branch: "br-1",
      worktreePath: "/tmp/wt1",
    });
    const s2 = repos.sessions.create({
      taskId: t2.id,
      baseRef: "main",
      branch: "br-2",
      worktreePath: "/tmp/wt2",
    });
    repos.sessions.update(s2.id, { status: "running" });
    const s3 = repos.sessions.create({
      taskId: t1.id,
      baseRef: "main",
      branch: "br-3",
      worktreePath: "/tmp/wt3",
    });
    repos.sessions.update(s3.id, { status: "awaiting_approval" });

    const s = service.summary();

    // counts
    expect(s.activeSessions).toBe(1); // running only (paused empty); awaiting_approval excluded from this count
    expect(s.awaitingApproval).toBe(1);
    expect(s.openTasks).toBe(2); // t1 + p2's task; t2 in_progress

    // running rail surfaces non-terminal sessions across projects, newest first
    expect(s.runningSessions).toHaveLength(2);
    expect(s.runningSessions.map((r) => r.sessionId)).toEqual([s3.id, s2.id]);
    expect(s.runningSessions[0]).toMatchObject({
      sessionId: s3.id,
      taskId: t1.id,
      taskTitle: "task-1",
      projectId: p1.id,
      projectName: "alpha",
      status: "awaiting_approval",
    });

    // project rollup is alpha-sorted and counts active sessions+open tasks
    expect(s.projects.map((p) => p.name)).toEqual(["alpha", "beta"]);
    const alpha = s.projects.find((p) => p.name === "alpha")!;
    expect(alpha.openTasks).toBe(1);
    expect(alpha.activeSessions).toBe(2); // s2 running + s3 awaiting_approval
    const beta = s.projects.find((p) => p.name === "beta")!;
    expect(beta.openTasks).toBe(1);
    expect(beta.activeSessions).toBe(0);
  });

  it("merges task creation + session lifecycle into a single recent-activity feed (newest first, capped)", () => {
    const p = repos.projects.create({ rootPath: "/tmp/p", name: "alpha" });
    for (let i = 0; i < 6; i++) {
      const t = repos.tasks.create({ projectId: p.id, title: `t${i}` });
      const s = repos.sessions.create({
        taskId: t.id,
        baseRef: "main",
        branch: `b${i}`,
        worktreePath: `/wt${i}`,
      });
      // mark a few completed (gives an ended_at via update)
      if (i < 2) {
        repos.sessions.update(s.id, {
          status: "completed",
          endedAt: new Date().toISOString(),
        });
      }
    }
    const feed = service.summary().recentActivity;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.length).toBeLessThanOrEqual(25);
    // newest first by ts
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1].ts >= feed[i].ts).toBe(true);
    }
    // contains task_created entries
    expect(feed.some((e) => e.kind === "task_created")).toBe(true);
    // contains session_started entries
    expect(feed.some((e) => e.kind === "session_started")).toBe(true);
    // contains session_completed entries (severity=ok)
    expect(feed.some((e) => e.kind === "session_completed" && e.severity === "ok")).toBe(true);
  });

  it("excludes archived projects from the project rollup", () => {
    const p = repos.projects.create({ rootPath: "/tmp/p", name: "alpha" });
    repos.projects.update(p.id, { archived: true });
    expect(service.summary().projects).toEqual([]);
  });
});
