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
let runner: ReviewOverrideRunner;
let taskId: string;
let stepEventsRepo: StepEventsRepo;
let pipelineStepsRepo: PipelineStepsRepo;

class ReviewOverrideRunner implements StepRunner {
  /**
   * What the LLM-style review verdict should look like. The test
   * configures this to assert the deterministic-override behavior:
   * `passed: true` but a failing AC must NOT be treated as passed.
   */
  reviewVerdict: {
    passed: boolean;
    summary: string;
    issues: Array<{ severity: string; file: string; message: string }>;
    acceptance_results: Array<{ id: string; passed: boolean; evidence: string }>;
    phase_results: Array<{ id: string; passed: boolean; evidence: string }>;
  } = {
    passed: true,
    summary: "All looks fine",
    issues: [],
    acceptance_results: [
      { id: "AC1", passed: false, evidence: "Sensors gap is still 24px in the diff" },
    ],
    phase_results: [
      { id: "P1", passed: true, evidence: "Token file edited" },
    ],
  };

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
      const json = makePlanJson();
      return {
        status: "completed",
        threadId: "plan-thread",
        finalText: JSON.stringify(json),
        json,
      };
    }
    if (input.role.role === "code_review") {
      return {
        status: "completed",
        threadId: "review-thread",
        finalText: JSON.stringify(this.reviewVerdict),
        json: this.reviewVerdict,
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
  tmp = mkdtempSync(join(tmpdir(), "ad-revov-"));
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

  pipelineStepsRepo = new PipelineStepsRepo(db);
  stepEventsRepo = new StepEventsRepo(db);
  const repos = {
    sessions: new SessionsRepo(db),
    tasks: new TasksRepo(db),
    projects: new ProjectsRepo(db),
    taskLinks: new TaskLinksRepo(db),
    atlassianCache: new AtlassianCacheRepo(db),
    metaContexts: new MetaContextsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
    pipelineSteps: pipelineStepsRepo,
    stepEvents: stepEventsRepo,
    stepArtifacts: new StepArtifactsRepo(db),
  };
  const project = repos.projects.create({ rootPath: projectRoot, name: "repoX" });
  const task = repos.tasks.create({ projectId: project.id, title: "Review override test" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new ReviewOverrideRunner();
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

describe("Phase 39 — coordinator review-completion deterministic override", () => {
  it("LLM passed=true but an AC failed → coordinator routes to review-fail (back to plan) and emits review_passed_overridden event", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );
    await coordinator.approve(start.sessionId);

    // After approve: implement → code_review → handleReviewFailure
    // resets plan/implement/code_review to pending and lands the
    // session back in awaiting_approval (the existing review-failure
    // recovery path) — NOT in completed.
    await waitFor(() => {
      const s = sessionStatus(db, start.sessionId);
      return s === "awaiting_approval" || s === "completed" || s === "failed";
    }, 8000);
    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_approval");

    // The review step's events include a review_passed_overridden entry
    // capturing the failed AC id.
    const reviewStep = stepRowByOrd(db, start.sessionId, 4);
    const events = stepEventsRepo.listForStep(reviewStep.id);
    const overridden = events.find((e) => e.kind === "review_passed_overridden");
    expect(overridden).toBeTruthy();
    const payload = JSON.parse(overridden!.payloadJson) as Record<string, unknown>;
    expect(payload.llm_passed).toBe(true);
    expect(payload.derived_passed).toBe(false);
    expect(payload.failed_acceptance_ids).toEqual(["AC1"]);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("LLM passed=true with all ACs passed and no blocking issues → completes (no override)", async () => {
    runner.reviewVerdict = {
      passed: true,
      summary: "All looks fine",
      issues: [],
      acceptance_results: [
        { id: "AC1", passed: true, evidence: "32px gap applied in tokens.css" },
      ],
      phase_results: [
        { id: "P1", passed: true, evidence: "Token file edited" },
      ],
    };
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );
    await coordinator.approve(start.sessionId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "completed",
      8000,
    );

    const reviewStep = stepRowByOrd(db, start.sessionId, 4);
    const events = stepEventsRepo.listForStep(reviewStep.id);
    expect(events.find((e) => e.kind === "review_passed_overridden")).toBeUndefined();

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("failed review plus user feedback re-enters plan, then accepted plan proceeds through passing review", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );
    await coordinator.approve(start.sessionId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    runner.reviewVerdict = {
      passed: true,
      summary: "All looks fine",
      issues: [],
      acceptance_results: [
        { id: "AC1", passed: true, evidence: "Acceptance criteria addressed after re-plan" },
      ],
      phase_results: [
        { id: "P1", passed: true, evidence: "Phase complete after re-plan" },
      ],
    };

    await coordinator.reject(
      start.sessionId,
      "Also include the extra edge case the user noticed.",
    );
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const rejections = stepEventsRepo
      .listForStep(planStep.id)
      .filter((e) => e.kind === "rejection")
      .map((e) => JSON.parse(e.payloadJson) as { comment: string; source?: string });
    expect(rejections.some((e) => e.source === "code_review")).toBe(true);
    expect(
      rejections.some((e) => e.comment.includes("extra edge case")),
    ).toBe(true);

    await coordinator.approve(start.sessionId);
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
): { id: string } {
  return d
    .prepare(
      `SELECT s.id FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ? AND s.ord = ?`,
    )
    .get(sessionId, ord) as { id: string };
}
