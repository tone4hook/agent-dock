import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { EventBus, WorkflowCoordinator, type OrchestratorEvent } from "../src/index.js";
import { makePlanJson } from "./_planFixture.js";

let tmp: string;
let workspaceDir: string;
let projectRoot: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let runner: MockStepRunner;
let projectId: string;
let taskId: string;

class MockStepRunner implements StepRunner {
  finalText = "## Summary\nFake findings\n";
  /** Per-role overrides for json/finalText. */
  reviewVerdict: { passed: boolean; summary: string; issues: unknown[] } | null = {
    passed: true,
    summary: "looks good",
    issues: [],
  };
  constructor() {}
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });
    input.onEvent({ kind: "agent", payload: { type: "tool_use", name: "Read" } });
    input.onEvent({ kind: "stderr", payload: { line: "noisy line" } });
    if (input.role.role === "clarify") {
      // Phase 33: default mock returns all_clear so existing tests
      // breeze through clarify without changing their setup.
      const json = { status: "all_clear" };
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return { status: "completed", threadId: "fake-thread-uuid", finalText, json };
    }
    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return { status: "completed", threadId: "fake-thread-uuid", finalText, json };
    }
    if (input.role.role === "code_review") {
      const json = this.reviewVerdict;
      const finalText = json ? JSON.stringify(json) : this.finalText;
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "fake-thread-uuid",
        finalText,
        json: json ?? undefined,
      };
    }
    if (input.role.role === "plan") {
      const json = makePlanJson();
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "fake-thread-uuid",
        finalText,
        json,
      };
    }
    input.onEvent({
      kind: "agent",
      payload: { type: "message", role: "assistant", text: this.finalText },
    });
    return {
      status: "completed",
      threadId: "fake-thread-uuid",
      finalText: this.finalText,
    };
  }
}

/**
 * Step runner that hangs on a chosen role until the abort signal fires,
 * then resolves as cancelled. Lets us simulate a long-running step we
 * can pause/resume.
 */
class PausableStepRunner implements StepRunner {
  hangOnRole: string | null = null;
  resumeCalls: Array<{ role: string; resumeThreadId: string | null }> = [];
  threadIds = new Map<string, string>(); // role → thread id
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    const tid = this.threadIds.get(input.role.role) ?? `tid-${input.role.role}`;
    this.threadIds.set(input.role.role, tid);
    this.resumeCalls.push({
      role: input.role.role,
      resumeThreadId: input.resumeThreadId ?? null,
    });
    input.onThreadId?.(tid);
    if (this.hangOnRole === input.role.role) {
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) return resolve();
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        status: "cancelled",
        threadId: tid,
        finalText: "",
      };
    }
    input.onEvent({
      kind: "agent",
      payload: { type: "message", role: "assistant", text: "ok" },
    });
    if (input.role.role === "clarify") {
      const json = { status: "all_clear" };
      return { status: "completed", threadId: tid, finalText: JSON.stringify(json), json };
    }
    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      return { status: "completed", threadId: tid, finalText: JSON.stringify(json), json };
    }
    if (input.role.role === "code_review") {
      const json = { passed: true, summary: "ok", issues: [] };
      return {
        status: "completed",
        threadId: tid,
        finalText: JSON.stringify(json),
        json,
      };
    }
    if (input.role.role === "plan") {
      const json = makePlanJson();
      return {
        status: "completed",
        threadId: tid,
        finalText: JSON.stringify(json),
        json,
      };
    }
    return { status: "completed", threadId: tid, finalText: "ok" };
  }
}

class FailingStepRunner implements StepRunner {
  async run(_input: StepRunnerInput): Promise<StepRunnerResult> {
    return {
      status: "failed",
      threadId: null,
      finalText: "",
      errorMessage: "boom",
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-orch-"));
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
  projectId = project.id;
  const task = repos.tasks.create({ projectId, title: "Build a thing" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new MockStepRunner();
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

describe("WorkflowCoordinator", () => {
  it("auto-advances investigate→plan and lands in awaiting_approval", async () => {
    const start = await coordinator.start(taskId);

    const events: OrchestratorEvent[] = [];
    const unsub = eventBus.subscribe(start.sessionId, (e) => events.push(e));

    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");
    unsub();

    expect(existsSync(start.worktreePath)).toBe(true);
    expect(existsSync(join(start.worktreePath, ".context", "PACK.md"))).toBe(true);
    expect(existsSync(join(start.worktreePath, ".plan", "findings.md"))).toBe(true);
    expect(existsSync(join(start.worktreePath, ".plan", "task_plan.md"))).toBe(true);

    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_approval");
    expect(sessionWorktree(db, start.sessionId)).toBe(start.worktreePath);
    expect(sessionBranch(db, start.sessionId)).toMatch(/^agent-dock\/[^/]+\/[^/]+$/);

    // 5-step pipeline (validate reverted): investigate→clarify→plan all
    // complete; implement+code_review remain pending.
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "completed",
      "completed",
      "completed",
      "pending",
      "pending",
    ]);

    const investigateStep = stepRowByOrd(db, start.sessionId, 0);
    expect(investigateStep.thread_id).toBe("fake-thread-uuid");
    expect(stepArtifactsForStep(db, investigateStep.id).map((a) => a.kind)).toEqual([
      "findings",
    ]);
    const planStep = stepRowByOrd(db, start.sessionId, 2);
    // Phase 36/37: plan step now persists both plan_structured (the JSON
    // artifact, written by the expected-artifacts fallback to .plan/plan.json)
    // and plan (the markdown companion .plan/task_plan.md).
    expect(stepArtifactsForStep(db, planStep.id).map((a) => a.kind)).toEqual([
      "plan_structured",
      "plan",
    ]);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("approve advances awaiting_approval → implement → code_review → completed", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");

    await coordinator.approve(start.sessionId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "completed");

    expect(stepStatusList(db, start.sessionId)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("reject(comment) re-runs the plan step with feedback in the pack", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");

    await coordinator.reject(start.sessionId, "make it more aggressive about edge cases");
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval", 5000);

    // Phase 33: plan is now ord=2 (clarify is ord=1).
    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const events = stepEventsForStep(db, planStep.id);
    const rejection = events.find((e) => e.kind === "rejection");
    expect(rejection).toBeTruthy();
    expect(rejection!.payload_json.includes("aggressive about edge cases")).toBe(true);

    const pack = readFileSync(join(start.worktreePath, ".context", "PACK.md"), "utf8");
    expect(pack.includes("aggressive about edge cases")).toBe(true);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("code-review passed=false routes back to awaiting_approval with summary as planner feedback", async () => {
    runner.reviewVerdict = {
      passed: false,
      summary: "missing test coverage for the empty-list path",
      issues: [
        {
          severity: "blocker",
          file: "src/foo.ts",
          line: 12,
          message: "no test for [] input",
        },
      ],
    };

    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");
    await coordinator.approve(start.sessionId); // → implement → code_review (fail) → awaiting_approval
    // 5-step pipeline (validate reverted): handleReviewFailure resets
    // plan/implement/code_review; investigate+clarify stay completed.
    await waitFor(
      () =>
        sessionStatus(db, start.sessionId) === "awaiting_approval" &&
        stepStatusList(db, start.sessionId).join(",") ===
          "completed,completed,pending,pending,pending",
      8000,
    );

    const codeReviewStep = stepRowByOrd(db, start.sessionId, 4);
    const reviewArtifacts = stepArtifactsForStep(db, codeReviewStep.id);
    expect(reviewArtifacts.map((a) => a.kind)).toContain("review_result");

    const planStep = stepRowByOrd(db, start.sessionId, 2);
    const events = stepEventsForStep(db, planStep.id);
    const rejection = events.find(
      (e) =>
        e.kind === "rejection" && e.payload_json.includes("missing test coverage"),
    );
    expect(rejection).toBeTruthy();

    const pack = readFileSync(join(start.worktreePath, ".context", "PACK.md"), "utf8");
    expect(pack.includes("missing test coverage")).toBe(true);

    // Flip verdict; approve re-runs plan (gates again) then approve
    // to flow implement → code_review (pass) → completed.
    runner.reviewVerdict = { passed: true, summary: "all good now", issues: [] };
    await coordinator.approve(start.sessionId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );
    await coordinator.approve(start.sessionId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "completed", 8000);
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("pause(sessionId) interrupts the in-flight step and resume re-runs it with the persisted thread_id", async () => {
    // Re-create coordinator with a pausable runner that hangs on
    // "investigate". The thread_id is reported via onThreadId before
    // any await so a crash mid-run still leaves it persisted.
    const pausable = new PausableStepRunner();
    pausable.hangOnRole = "investigate";
    coordinator = new WorkflowCoordinator({
      repos: {
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
      },
      worktrees: new WorktreeManager(),
      runner: pausable,
      workflow: featureFlow,
      eventBus,
      workspaceDir,
    });

    const start = await coordinator.start(taskId);
    // Wait until the runner has reported its thread_id (proves the
    // step row carries it BEFORE the run finishes / is aborted).
    await waitFor(
      () => stepRowByOrd(db, start.sessionId, 0).thread_id === "tid-investigate",
      3000,
    );

    const pauseStarted = Date.now();
    await coordinator.pause(start.sessionId);
    expect(Date.now() - pauseStarted).toBeLessThan(2000);
    expect(sessionStatus(db, start.sessionId)).toBe("paused");
    // Step should remain pending/in-flight, not "cancelled" or "failed".
    // 5-step pipeline (validate reverted): all 5 start as pending.
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(stepRowByOrd(db, start.sessionId, 0).thread_id).toBe("tid-investigate");

    // Now flip off the hang and resume — runner should be invoked
    // with resumeThreadId = the persisted id.
    pausable.hangOnRole = null;
    pausable.resumeCalls = [];
    await coordinator.resume(start.sessionId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval", 5000);

    const resumeInvestigate = pausable.resumeCalls.find((c) => c.role === "investigate");
    expect(resumeInvestigate?.resumeThreadId).toBe("tid-investigate");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("rejects start() with status=409 when active session count >= cap", async () => {
    // Pre-seed 3 sessions in active states (running/awaiting_approval/paused)
    // by directly inserting via the repos so we don't run worktree setup.
    const repos = new SessionsRepo(db);
    const taskA = new TasksRepo(db).create({ projectId: projectId, title: "A" });
    const taskB = new TasksRepo(db).create({ projectId: projectId, title: "B" });
    const taskC = new TasksRepo(db).create({ projectId: projectId, title: "C" });
    for (const tid of [taskA.id, taskB.id, taskC.id]) {
      const s = repos.create({
        taskId: tid,
        baseRef: "main",
        branch: "main",
        worktreePath: "/tmp/x",
      });
      repos.update(s.id, { status: "running" });
    }
    expect(repos.countActive()).toBe(3);

    const err = await coordinator.start(taskId).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { status?: number }).status).toBe(409);
    expect((err as Error).message).toContain("session cap reached");
    expect((err as Error).message).toContain("3/3");
  });

  it("on a runner failure, marks the session failed with no advance", async () => {
    // Re-create coordinator with a failing runner.
    coordinator = new WorkflowCoordinator({
      repos: {
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
      },
      worktrees: new WorktreeManager(),
      runner: new FailingStepRunner(),
      workflow: featureFlow,
      eventBus,
      workspaceDir,
    });

    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "failed");
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "failed",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const failedStep = stepRowByOrd(db, start.sessionId, 0);
    const statusEvents = stepEventsForStep(db, failedStep.id).filter(
      (e) => e.kind === "step_status",
    );
    expect(statusEvents.length).toBeGreaterThan(0);
    expect(JSON.parse(statusEvents.at(-1)!.payload_json)).toMatchObject({
      status: "failed",
      error: "boom",
    });

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });
});

// ---------- helpers ----------

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

function sessionStatus(db: Database.Database, id: string): string {
  return (db.prepare("SELECT status FROM sessions WHERE id = ?").get(id) as { status: string }).status;
}
function sessionWorktree(db: Database.Database, id: string): string {
  return (db.prepare("SELECT worktree_path FROM sessions WHERE id = ?").get(id) as { worktree_path: string }).worktree_path;
}
function sessionBranch(db: Database.Database, id: string): string {
  return (db.prepare("SELECT branch FROM sessions WHERE id = ?").get(id) as { branch: string }).branch;
}
function stepStatusList(db: Database.Database, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT s.status FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ?
       ORDER BY s.ord ASC`,
    )
    .all(sessionId) as Array<{ status: string }>;
  return rows.map((r) => r.status);
}
function stepRowByOrd(
  db: Database.Database,
  sessionId: string,
  ord: number,
): { id: string; thread_id: string | null } {
  return db
    .prepare(
      `SELECT s.id, s.thread_id FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ? AND s.ord = ?`,
    )
    .get(sessionId, ord) as { id: string; thread_id: string | null };
}
function stepEventsForStep(db: Database.Database, stepId: string): Array<{ kind: string; payload_json: string }> {
  return db
    .prepare("SELECT kind, payload_json FROM step_events WHERE step_id = ? ORDER BY id ASC")
    .all(stepId) as Array<{ kind: string; payload_json: string }>;
}
function stepArtifactsForStep(db: Database.Database, stepId: string): Array<{ kind: string; file_path: string }> {
  return db
    .prepare("SELECT kind, file_path FROM step_artifacts WHERE step_id = ? ORDER BY created_at ASC")
    .all(stepId) as Array<{ kind: string; file_path: string }>;
}
