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
import { EventBus, WorkflowCoordinator } from "../src/index.js";
import { makePlanJson } from "./_planFixture.js";

let tmp: string;
let workspaceDir: string;
let projectRoot: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let runner: NoOpRunner;
let taskId: string;

/**
 * Mock runner exercising the Phase 32 path:
 * - implementer emits a `NO_CHANGES:` final message and zero file changes
 * - reviewer detects the marker in upstream artifacts and passes the session
 */
class NoOpRunner implements StepRunner {
  /** Toggle to test the negative path (silent no-op without the signal). */
  emitNoChangesSignal = true;
  /** Verdict the mocked reviewer returns. */
  reviewerVerdict: { passed: boolean; summary: string; issues: unknown[] } = {
    passed: true,
    summary: "Intentional no-op: scope unclear; recommend re-planning.",
    issues: [],
  };

  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });

    // Phase 33: clarify + validate auto-pass so existing tests stay focused.
    if (input.role.role === "clarify") {
      const json = { status: "all_clear" };
      return { status: "completed", threadId: "clarify-thread", finalText: JSON.stringify(json), json };
    }
    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      return { status: "completed", threadId: "validate-thread", finalText: JSON.stringify(json), json };
    }

    if (input.role.role === "implement") {
      const finalText = this.emitNoChangesSignal
        ? "NO_CHANGES: planner produced a `## Scope insufficient` plan; nothing to implement."
        : ""; // negative path: silent no-op
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "implement-thread",
        finalText,
      };
    }

    if (input.role.role === "code_review") {
      const finalText = JSON.stringify(this.reviewerVerdict);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "review-thread",
        finalText,
        json: this.reviewerVerdict,
      };
    }

    if (input.role.role === "plan") {
      // Phase 37: planner must emit a valid structured plan. The NO_CHANGES
      // recovery path is independent of plan shape — what matters is that
      // implementer signals NO_CHANGES and reviewer accepts.
      const json = makePlanJson();
      const finalText = JSON.stringify(json);
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
    // investigate: benign markdown.
    const finalText = "## Summary\nNothing to investigate beyond the task description.\n";
    input.onEvent({
      kind: "agent",
      payload: { type: "message", role: "assistant", text: finalText },
    });
    return {
      status: "completed",
      threadId: `${input.role.role}-thread`,
      finalText,
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-noop-"));
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
  const task = repos.tasks.create({ projectId: project.id, title: "Testing 123" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new NoOpRunner();
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

describe("Phase 32 — intentional no-op recovery", () => {
  it("implementer NO_CHANGES + reviewer passed=true → session completes (no review-failure loop)", async () => {
    runner.emitNoChangesSignal = true;
    runner.reviewerVerdict = {
      passed: true,
      summary: "Intentional no-op: planner produced Scope insufficient; recommend re-planning.",
      issues: [],
    };

    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");
    await coordinator.approve(start.sessionId); // → implement → code_review (pass) → completed
    await waitFor(() => sessionStatus(db, start.sessionId) === "completed", 8000);

    // 5-step pipeline (validate reverted): all complete on the happy
    // NO_CHANGES path.
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);

    // Implement step persisted the finalText to .handoff/implement_summary.md
    // so the reviewer's ContextPack would have surfaced the NO_CHANGES signal.
    const implementStep = stepRowByOrd(db, start.sessionId, 3);
    const implementArtifacts = stepArtifactsForStep(db, implementStep.id);
    expect(implementArtifacts.map((a) => a.kind)).toContain("implement_summary");
    const summary = implementArtifacts.find((a) => a.kind === "implement_summary");
    expect(summary?.preview ?? "").toContain("NO_CHANGES:");

    const summaryFile = join(start.worktreePath, ".handoff", "implement_summary.md");
    expect(existsSync(summaryFile)).toBe(true);
    expect(readFileSync(summaryFile, "utf8")).toContain("NO_CHANGES:");

    // Review verdict captured as passed=true.
    const reviewStep = stepRowByOrd(db, start.sessionId, 4);
    const reviewArtifacts = stepArtifactsForStep(db, reviewStep.id);
    const verdictArtifact = reviewArtifacts.find((a) => a.kind === "review_result");
    expect(verdictArtifact).toBeTruthy();
    expect(verdictArtifact!.preview ?? "").toContain('"passed":true');

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("silent no-op (empty diff, no NO_CHANGES marker) + reviewer passed=false → still routes to awaiting_approval", async () => {
    // Negative path: the new prompt rule is enforced by the reviewer's
    // prompt copy at runtime, not by orchestrator code. Here we simulate
    // a reviewer that correctly fails a silent no-op so we can prove the
    // existing fail-loop still works for the unguarded path — i.e.,
    // Phase 32 doesn't accidentally turn every empty diff into a pass.
    runner.emitNoChangesSignal = false;
    runner.reviewerVerdict = {
      passed: false,
      summary: "Empty diff with no NO_CHANGES signal; implementer skipped silently.",
      issues: [
        {
          severity: "blocker",
          file: ".plan/task_plan.md",
          message: "no diff and no documented blocker",
        },
      ],
    };

    const start = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, start.sessionId) === "awaiting_approval");
    await coordinator.approve(start.sessionId);
    // Phase 14 fail-loop returns to awaiting_approval (NOT completed).
    // 5-step pipeline (validate reverted): handleReviewFailure resets
    // plan/implement/code_review to pending while investigate+clarify
    // stay completed.
    await waitFor(
      () =>
        sessionStatus(db, start.sessionId) === "awaiting_approval" &&
        stepStatusList(db, start.sessionId).join(",") ===
          "completed,completed,pending,pending,pending",
      8000,
    );

    const implementStep = stepRowByOrd(db, start.sessionId, 3);
    const implementArtifacts = stepArtifactsForStep(db, implementStep.id);
    const summary = implementArtifacts.find((a) => a.kind === "implement_summary");
    // The summary artifact still gets written even when finalText is empty
    // (covers the "implementer crashed silently" surface — the reviewer can
    // still observe an empty summary and fail).
    expect(summary).toBeTruthy();
    expect(summary?.preview ?? "").not.toContain("NO_CHANGES:");

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
function sessionBranch(d: Database.Database, id: string): string {
  return (d.prepare("SELECT branch FROM sessions WHERE id = ?").get(id) as { branch: string }).branch;
}
function stepStatusList(d: Database.Database, sessionId: string): string[] {
  const rows = d
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
  d: Database.Database,
  sessionId: string,
  ord: number,
): { id: string; thread_id: string | null } {
  return d
    .prepare(
      `SELECT s.id, s.thread_id FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ? AND s.ord = ?`,
    )
    .get(sessionId, ord) as { id: string; thread_id: string | null };
}
function stepArtifactsForStep(d: Database.Database, stepId: string): Array<{ kind: string; preview: string | null }> {
  return d
    .prepare("SELECT kind, preview FROM step_artifacts WHERE step_id = ? ORDER BY created_at ASC")
    .all(stepId) as Array<{ kind: string; preview: string | null }>;
}
