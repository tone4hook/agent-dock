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
let runner: ClarifyRouteRunner;
let taskId: string;

class ClarifyRouteRunner implements StepRunner {
  /** Plan invocation count — flips behavior between runs. */
  planInvocations = 0;

  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });

    if (input.role.role === "clarify") {
      const json = { status: "all_clear" };
      return {
        status: "completed",
        threadId: "clarify-thread",
        finalText: JSON.stringify(json),
        json,
      };
    }
    if (input.role.role === "plan") {
      this.planInvocations += 1;
      // First plan run: emit open_questions to trigger auto-route.
      // Second plan run (after answers): emit a clean plan.
      const json =
        this.planInvocations === 1
          ? makePlanJson({
              open_questions: [
                "Should we cap the export at 10MB or stream chunked output?",
              ],
            })
          : makePlanJson();
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: `plan-thread-${this.planInvocations}`,
        finalText,
        json,
      };
    }
    if (input.role.role === "code_review") {
      const json = { passed: true, summary: "ok", issues: [] };
      return {
        status: "completed",
        threadId: "review-thread",
        finalText: JSON.stringify(json),
        json,
      };
    }
    return {
      status: "completed",
      threadId: `${input.role.role}-thread`,
      finalText: "ok\n",
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-clarroute-"));
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
  const task = repos.tasks.create({ projectId: project.id, title: "Clarify-route test" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new ClarifyRouteRunner();
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

describe("Phase 37 — clarify auto-route round-trip", () => {
  it("plan emits open_questions → user submits answers → plan re-runs and lands awaiting_approval (answers persisted as task-scoped meta-context)", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    expect(runner.planInvocations).toBe(1);

    await coordinator.submitClarificationAnswers(start.sessionId, {
      q1: "Stream chunked output (no hard cap)",
    });

    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    // Planner ran twice — once for the initial open_questions emission,
    // once after answers came back.
    expect(runner.planInvocations).toBe(2);

    // Answers persisted as task-scoped meta-context (consumed by next ContextPack render).
    const answers = listMetaContextsForTask(db, taskId).find(
      (m) => m.kind === "clarification_answers",
    );
    expect(answers).toBeTruthy();
    expect(answers!.body_md).toContain("Stream chunked output");

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
  return (
    d.prepare("SELECT status FROM sessions WHERE id = ?").get(id) as {
      status: string;
    }
  ).status;
}
function sessionBranch(d: Database.Database, id: string): string {
  return (
    d.prepare("SELECT branch FROM sessions WHERE id = ?").get(id) as {
      branch: string;
    }
  ).branch;
}
function listMetaContextsForTask(
  d: Database.Database,
  tId: string,
): Array<{ kind: string; body_md: string }> {
  return d
    .prepare(
      "SELECT kind, body_md FROM meta_contexts WHERE scope_type = 'task' AND scope_id = ? ORDER BY created_at ASC",
    )
    .all(tId) as Array<{ kind: string; body_md: string }>;
}
