import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AtlassianCacheRepo,
  MetaContextsRepo,
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  StepArtifactsRepo,
  StepEventsRepo,
  TaskLinksRepo,
  TasksRepo,
  WorkflowRunsRepo,
  migrate,
} from "@agent-dock/db";
import { featureFlow } from "@agent-dock/workflows";
import { WorktreeManager, gitOrThrow } from "@agent-dock/worktrees";
import type {
  StepRunner,
  StepRunnerInput,
  StepRunnerResult,
} from "@agent-dock/agents";
import { EventBus, WorkflowCoordinator } from "../src/index.js";
import { makePlanJson } from "./_planFixture.js";

let tmp: string;
let workspaceDir: string;
let projectRoot: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let runner: TransientFailRunner;
let taskId: string;

class TransientFailRunner implements StepRunner {
  /** Maps role → number of times the role has been invoked. */
  invocationCounts = new Map<string, number>();
  /** Roles whose first invocation should fail; subsequent invocations succeed. */
  failOnceFor = new Set<string>(["investigate"]);

  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    const role = input.role.role;
    const count = (this.invocationCounts.get(role) ?? 0) + 1;
    this.invocationCounts.set(role, count);

    if (this.failOnceFor.has(role) && count === 1) {
      return {
        status: "failed",
        threadId: `${role}-thread`,
        finalText: "",
        errorMessage: `transient ${role} failure (attempt ${count})`,
      };
    }

    if (role === "clarify") {
      const json = { status: "all_clear" };
      return { status: "completed", threadId: `${role}-thread`, finalText: JSON.stringify(json), json };
    }
    if (role === "validate") {
      const json = { passed: true, reason: "ok" };
      return { status: "completed", threadId: `${role}-thread`, finalText: JSON.stringify(json), json };
    }
    if (role === "code_review") {
      const json = { passed: true, summary: "ok", issues: [] };
      return { status: "completed", threadId: `${role}-thread`, finalText: JSON.stringify(json), json };
    }
    if (role === "plan") {
      const json = makePlanJson();
      const finalText = JSON.stringify(json);
      input.onEvent({ kind: "agent", payload: { type: "message", role: "assistant", text: finalText } });
      return { status: "completed", threadId: `${role}-thread`, finalText, json };
    }
    const finalText = "## Summary\nok\n";
    input.onEvent({ kind: "agent", payload: { type: "message", role: "assistant", text: finalText } });
    return { status: "completed", threadId: `${role}-thread`, finalText };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-retry-"));
  workspaceDir = join(tmp, "ws");
  projectRoot = join(workspaceDir, "repoX");
  mkdirSync(projectRoot, { recursive: true });
  await gitOrThrow(workspaceDir, ["init", "-q", "-b", "main", projectRoot]);
  await gitOrThrow(projectRoot, ["config", "user.email", "t@e.com"]);
  await gitOrThrow(projectRoot, ["config", "user.name", "t"]);
  writeFileSync(join(projectRoot, "README.md"), "hi\n");
  await gitOrThrow(projectRoot, ["add", "."]);
  await gitOrThrow(projectRoot, ["commit", "-q", "-m", "init"]);

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);

  const repos = {
    sessions: new SessionsRepo(db),
    tasks: new TasksRepo(db),
    projects: new ProjectsRepo(db),
    taskLinks: new TaskLinksRepo(db),
    atlassianCache: new AtlassianCacheRepo(db),
    metaContexts: new MetaContextsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
    pipelineSteps: new PipelineStepsRepo(db),
    stepEvents: new StepEventsRepo(db),
    stepArtifacts: new StepArtifactsRepo(db),
  };
  const project = repos.projects.create({ rootPath: projectRoot, name: "repoX" });
  const task = repos.tasks.create({ projectId: project.id, title: "Build" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new TransientFailRunner();
  coordinator = new WorkflowCoordinator({
    repos,
    worktrees: new WorktreeManager(),
    runner,
    workflow: featureFlow,
    eventBus,
    workspaceDir,
  });
});

afterEach(() => {
  db?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Phase 34 — retryStep", () => {
  it("retryStep re-runs the failed step in the same session and worktree, advancing past the transient failure", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "failed", 8000);

    // Investigate ran once and failed.
    expect(runner.invocationCounts.get("investigate")).toBe(1);

    // Retry: should re-run investigate and then proceed through the
    // rest of the (mocked) pipeline to awaiting_approval.
    await coordinator.retryStep(start.sessionId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    // Investigate ran twice; worktree path is unchanged (same session).
    expect(runner.invocationCounts.get("investigate")).toBe(2);
    expect(sessionWorktree(db, start.sessionId)).toBe(start.worktreePath);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("retryStep throws 409 when session is awaiting_approval (not failed)", async () => {
    runner.failOnceFor.clear(); // never fail; pipeline goes straight through
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    await expect(coordinator.retryStep(start.sessionId)).rejects.toThrow(
      /not failed/,
    );

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });
});

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

function sessionStatus(d: Database.Database, id: string): string {
  return (d.prepare("SELECT status FROM sessions WHERE id = ?").get(id) as { status: string }).status;
}
function sessionWorktree(d: Database.Database, id: string): string {
  return (d.prepare("SELECT worktree_path FROM sessions WHERE id = ?").get(id) as { worktree_path: string }).worktree_path;
}
function sessionBranch(d: Database.Database, id: string): string {
  return (d.prepare("SELECT branch FROM sessions WHERE id = ?").get(id) as { branch: string }).branch;
}
