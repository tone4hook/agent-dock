import Database from "better-sqlite3";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { makePlanJson, type PlanFixture } from "./_planFixture.js";

let tmp: string;
let workspaceDir: string;
let projectRoot: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let runner: PlanRouterRunner;
let taskId: string;

class PlanRouterRunner implements StepRunner {
  /** Override the plan JSON returned by the runner per test case. */
  planOverride: PlanFixture | null = null;
  emptyPlanFinalText = false;

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
      const json = this.planOverride ?? makePlanJson();
      const finalText = this.emptyPlanFinalText ? "" : JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "plan-thread",
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
  tmp = mkdtempSync(join(tmpdir(), "ad-plangate-"));
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
  const task = repos.tasks.create({ projectId: project.id, title: "Plan gate test" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new PlanRouterRunner();
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

describe("Phase 37 — plan approval gate", () => {
  it("schema-clean plan → session=awaiting_approval, no plan_gaps artifact", async () => {
    runner.planOverride = makePlanJson();
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const artifacts = stepArtifactsForStep(db, planStep.id);
    expect(artifacts.find((a) => a.kind === "plan_gaps")).toBeUndefined();
    // plan_structured (the JSON) must be present so the UI can render it.
    expect(artifacts.find((a) => a.kind === "plan_structured")).toBeTruthy();

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("structured-output plan with empty finalText still writes non-empty plan.json and awaits approval", async () => {
    runner.emptyPlanFinalText = true;
    runner.planOverride = makePlanJson();

    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const raw = readFileSync(
      join(start.worktreePath, ".plan", "plan.json"),
      "utf8",
    );
    expect(raw.length).toBeGreaterThan(20);
    expect(JSON.parse(raw)).toMatchObject({
      task_summary: expect.any(String),
      acceptance_criteria: expect.any(Array),
      phases: expect.any(Array),
    });

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const artifacts = stepArtifactsForStep(db, planStep.id);
    expect(artifacts.find((a) => a.kind === "plan_structured")).toBeTruthy();
    expect(artifacts.find((a) => a.kind === "plan")).toBeTruthy();
    expect(artifacts.find((a) => a.kind === "plan_gaps")).toBeUndefined();

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("plan with only open_questions populated → auto-route to clarify (awaiting_clarification + clarify_questions artifact)", async () => {
    runner.planOverride = makePlanJson({
      open_questions: [
        "Should the API surface a paginated cursor or offset-based pages?",
      ],
    });
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    const clarifyStep = stepRowByOrd(db, start.sessionId, 1);
    const artifacts = stepArtifactsForStep(db, clarifyStep.id);
    const questions = artifacts.find((a) => a.kind === "clarify_questions");
    expect(questions).toBeTruthy();
    const parsed = JSON.parse(questions!.preview ?? "[]");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "q1",
      text: expect.stringMatching(/paginated cursor or offset/),
    });

    // Plan step is reset to pending so it re-runs after answers come back.
    const planStep = stepRowByOrd(db, start.sessionId, 2);
    expect(planStep.status).toBe("pending");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("plan with vague done_when (gapsKind='other') → session=awaiting_approval AND plan_gaps artifact lists Zod errors", async () => {
    runner.planOverride = makePlanJson({
      patch: (plan) => {
        plan.phases[0].done_when = "TBD: figure it out later";
      },
    });
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const artifacts = stepArtifactsForStep(db, planStep.id);
    const gaps = artifacts.find((a) => a.kind === "plan_gaps");
    expect(gaps).toBeTruthy();
    expect(gaps!.preview ?? "").toMatch(/vague|TBD|done_when/i);

    // Server-side approve guard must reject this stale-tab approval.
    await expect(coordinator.approve(start.sessionId)).rejects.toMatchObject({
      status: 409,
    });

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("rejecting a gapped plan clears stale plan_gaps when the re-plan is valid and approve can continue", async () => {
    runner.planOverride = makePlanJson({
      patch: (plan) => {
        plan.phases[0].done_when = "TBD: figure it out later";
      },
    });
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    expect(
      stepArtifactsForStep(db, planStep.id).some((a) => a.kind === "plan_gaps"),
    ).toBe(true);

    runner.planOverride = makePlanJson();
    await coordinator.reject(start.sessionId, "Replace vague done_when with an observable check.");
    await waitFor(
      () =>
        sessionStatus(db, start.sessionId) === "awaiting_approval" &&
        stepArtifactsForStep(db, planStep.id).some(
          (a) => a.kind === "plan_structured",
        ),
      8000,
    );

    const artifacts = stepArtifactsForStep(db, planStep.id);
    expect(artifacts.find((a) => a.kind === "plan_gaps")).toBeUndefined();
    expect(artifacts.find((a) => a.kind === "plan_structured")).toBeTruthy();

    await expect(coordinator.approve(start.sessionId)).resolves.toBeUndefined();
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "completed",
      8000,
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
