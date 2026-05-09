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

let tmp: string;
let workspaceDir: string;
let projectRoot: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let runner: PlanFailRunner;
let taskId: string;

class PlanFailRunner implements StepRunner {
  /** Configurable: when true, plan returns failed (mimics SDK rejecting non-JSON). */
  planFails = true;

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
    if (input.role.role === "plan" && this.planFails) {
      return {
        status: "failed",
        threadId: null,
        finalText: "Here is a plan in markdown form...\n# Plan: ...\n",
        errorMessage: "outputSchema role returned non-JSON final text",
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
  tmp = mkdtempSync(join(tmpdir(), "ad-failsoft-"));
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
  const task = repos.tasks.create({ projectId: project.id, title: "Plan fail-soft" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new PlanFailRunner();
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

describe("Plan fail-soft (hotfix for outputSchema non-JSON loop)", () => {
  it("plan role failure → session lands in awaiting_approval with a plan_gaps artifact (NOT failed)", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_approval");

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    expect(planStep.status).toBe("completed");

    const artifacts = stepArtifactsForStep(db, planStep.id);
    const gaps = artifacts.find((a) => a.kind === "plan_gaps");
    expect(gaps).toBeTruthy();
    expect(gaps!.preview ?? "").toMatch(/Plan role failed/);
    expect(gaps!.preview ?? "").toMatch(/non-JSON/);
    expect(gaps!.preview ?? "").toMatch(/Reject-with-prompt/);

    // Diagnostic event preserved for audit.
    const events = stepEventsForStep(db, planStep.id);
    const softfall = events.find((e) => e.kind === "plan_failed_softfall");
    expect(softfall).toBeTruthy();

    // Server-side approve guard still blocks (plan.json missing/invalid).
    await expect(coordinator.approve(start.sessionId)).rejects.toMatchObject({
      status: 409,
    });

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
function stepRowByOrd(
  d: Database.Database,
  sessionId: string,
  ord: number,
): { id: string; status: string } {
  return d
    .prepare(
      `SELECT s.id, s.status FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ? AND s.ord = ?`,
    )
    .get(sessionId, ord) as { id: string; status: string };
}
function stepArtifactsForStep(
  d: Database.Database,
  stepId: string,
): Array<{ kind: string; preview: string | null }> {
  return d
    .prepare(
      "SELECT kind, preview FROM step_artifacts WHERE step_id = ? ORDER BY created_at ASC",
    )
    .all(stepId) as Array<{ kind: string; preview: string | null }>;
}
function stepEventsForStep(
  d: Database.Database,
  stepId: string,
): Array<{ kind: string; payloadJson: string }> {
  return d
    .prepare(
      "SELECT kind, payload_json AS payloadJson FROM step_events WHERE step_id = ? ORDER BY created_at ASC",
    )
    .all(stepId) as Array<{ kind: string; payloadJson: string }>;
}
