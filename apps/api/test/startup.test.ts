import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  migrate,
  ProjectsRepo,
  SessionsRepo,
  TasksRepo,
} from "@agent-dock/db";
import { WorktreeManager, gitOrThrow } from "@agent-dock/worktrees";
import { StartupService } from "../src/services/startup.js";

let tmp: string;
let db: Database.Database;
let projects: ProjectsRepo;
let sessions: SessionsRepo;
let tasks: TasksRepo;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-startup-"));
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  projects = new ProjectsRepo(db);
  sessions = new SessionsRepo(db);
  tasks = new TasksRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("StartupService.reconcile", () => {
  it("marks running/paused sessions whose worktree is missing as failed", async () => {
    const project = projects.create({ rootPath: tmp, name: "p" });
    const task = tasks.create({ projectId: project.id, title: "t" });

    const sessionA = sessions.create({
      taskId: task.id,
      baseRef: "main",
      branch: "agent-dock/missing",
      worktreePath: join(tmp, "missing-wt"),
    });
    sessions.update(sessionA.id, { status: "running" });

    const present = join(tmp, "present-wt");
    mkdirSync(present);
    const sessionB = sessions.create({
      taskId: task.id,
      baseRef: "main",
      branch: "agent-dock/present",
      worktreePath: present,
    });
    sessions.update(sessionB.id, { status: "paused" });

    const svc = new StartupService({ sessions, projects, worktrees: new WorktreeManager() });
    const report = await svc.reconcile();

    expect(report.staleSessions.map((s) => s.sessionId)).toEqual([sessionA.id]);
    expect(report.staleSessions[0].reason).toBe("interrupted by shutdown");
    expect(sessions.get(sessionA.id)?.status).toBe("failed");
    expect(sessions.get(sessionA.id)?.endedAt).toBeTruthy();
    expect(sessions.get(sessionB.id)?.status).toBe("paused"); // worktree exists → untouched
  });

  it("surfaces git worktrees that the DB doesn't know about as orphans", async () => {
    const projectRoot = join(tmp, "repo");
    mkdirSync(projectRoot);
    await gitOrThrow(tmp, ["init", "-q", "-b", "main", projectRoot]);
    await gitOrThrow(projectRoot, ["config", "user.email", "t@e.com"]);
    await gitOrThrow(projectRoot, ["config", "user.name", "t"]);
    writeFileSync(join(projectRoot, "README.md"), "hi\n");
    await gitOrThrow(projectRoot, ["add", "."]);
    await gitOrThrow(projectRoot, ["commit", "-q", "-m", "init"]);

    const orphanPath = join(tmp, "orphan-wt");
    await gitOrThrow(projectRoot, ["worktree", "add", "-b", "stray", orphanPath]);

    const project = projects.create({ rootPath: projectRoot, name: "repo" });

    const svc = new StartupService({ sessions, projects, worktrees: new WorktreeManager() });
    const report = await svc.reconcile();

    expect(report.orphanWorktrees.length).toBe(1);
    expect(report.orphanWorktrees[0].projectId).toBe(project.id);
    expect(report.orphanWorktrees[0].branch).toBe("stray");
  });
});
