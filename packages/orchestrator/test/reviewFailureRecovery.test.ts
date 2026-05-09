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
let runner: ReviewFailRunner;
let taskId: string;
let metaContexts: MetaContextsRepo;

class ReviewFailRunner implements StepRunner {
  reviewVerdict = {
    passed: false,
    summary: "missing tests for empty-list path",
    issues: [
      {
        severity: "blocker" as const,
        file: "src/foo.ts",
        line: 12,
        message: "no test for [] input",
      },
    ],
  };
  shouldPass = false;
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });
    // Phase 33: clarify + validate auto-pass.
    if (input.role.role === "clarify") {
      const json = { status: "all_clear" };
      return { status: "completed", threadId: "clarify-thread", finalText: JSON.stringify(json), json };
    }
    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      return { status: "completed", threadId: "validate-thread", finalText: JSON.stringify(json), json };
    }
    if (input.role.role === "code_review") {
      const verdict = this.shouldPass
        ? { passed: true, summary: "looks good", issues: [] }
        : this.reviewVerdict;
      const finalText = JSON.stringify(verdict);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: "review-thread",
        finalText,
        json: verdict,
      };
    }
    if (input.role.role === "plan") {
      const json = makePlanJson();
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return { status: "completed", threadId: "plan-thread", finalText, json };
    }
    input.onEvent({
      kind: "agent",
      payload: { type: "message", role: "assistant", text: "## ok\n" },
    });
    return {
      status: "completed",
      threadId: `${input.role.role}-thread`,
      finalText: "## ok\n",
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-rf-"));
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

  metaContexts = new MetaContextsRepo(db);
  const repos = {
    sessions: new SessionsRepo(db),
    tasks: new TasksRepo(db),
    projects: new ProjectsRepo(db),
    taskLinks: new TaskLinksRepo(db),
    atlassianCache: new AtlassianCacheRepo(db),
    metaContexts,
    workflowRuns: new WorkflowRunsRepo(db),
    pipelineSteps: new PipelineStepsRepo(db),
    stepEvents: new StepEventsRepo(db),
    stepArtifacts: new StepArtifactsRepo(db),
  };
  const project = repos.projects.create({ rootPath: projectRoot, name: "repoX" });
  const task = repos.tasks.create({ projectId: project.id, title: "Build it" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new ReviewFailRunner();
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

describe("Phase 31 — code-review failure recovery (branch fork + verdict propagation)", () => {
  it("starting a new session with baseRefOverride=<failed-branch> forks a worktree at that branch tip and inherits review_feedback meta-context", async () => {
    // 1. Run first session through review failure → awaiting_approval.
    const first = await coordinator.start(taskId);
    await waitFor(() => sessionStatus(db, first.sessionId) === "awaiting_approval");
    await coordinator.approve(first.sessionId); // → implement → code_review (fail)
    await waitFor(
      () =>
        sessionStatus(db, first.sessionId) === "awaiting_approval" &&
        // 5-step pipeline (validate reverted): investigate+clarify stay
        // completed through the review-failure reset.
        stepStatusList(db, first.sessionId).join(",") ===
          "completed,completed,pending,pending,pending",
      8000,
    );

    // 2. Persist the verdict as a task-scoped review_feedback meta-context.
    //    This is what the UI's "Save verdict to task" button posts.
    metaContexts.create({
      scopeType: "task",
      scopeId: taskId,
      kind: "review_feedback",
      bodyMd:
        "Code review failed: missing tests for empty-list path\n- [blocker] src/foo.ts:12 — no test for [] input",
    });

    // 3. Fork a new session off the failed session's branch.
    const failedBranch = sessionBranch(db, first.sessionId);
    const second = await coordinator.start(taskId, { baseRefOverride: failedBranch });

    // 4. Distinct worktree path; new branch derived from old.
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect(second.branch).not.toBe(failedBranch);
    expect(second.branch).toMatch(/^agent-dock\/[^/]+\/[^/]+$/);
    expect(existsSync(second.worktreePath)).toBe(true);

    // 5. New branch tip is reachable from the old branch tip (same
    //    commit since MockStepRunner doesn't commit; the assertion
    //    proves the fork point is at-or-after the failed branch).
    const firstTip = await revParse(projectRoot, failedBranch);
    const secondTip = await revParse(projectRoot, second.branch);
    expect(await isAncestor(projectRoot, firstTip, secondTip)).toBe(true);

    // 6. The new session's PACK.md contains the saved verdict body —
    //    proves task-scoped review_feedback meta-contexts flow into
    //    every future session's ContextPack.
    await waitFor(
      () => existsSync(join(second.worktreePath, ".context", "PACK.md")),
      5000,
    );
    const pack = readFileSync(join(second.worktreePath, ".context", "PACK.md"), "utf8");
    expect(pack.includes("missing tests for empty-list path")).toBe(true);
    expect(pack.includes("review_feedback")).toBe(true);

    // Cleanup both worktrees.
    const wm = new WorktreeManager();
    await wm.remove({
      projectRoot,
      worktreePath: first.worktreePath,
      branch: failedBranch,
    });
    await wm.remove({
      projectRoot,
      worktreePath: second.worktreePath,
      branch: second.branch,
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

async function revParse(cwd: string, ref: string): Promise<string> {
  const r = await gitOrThrow(cwd, ["rev-parse", ref]);
  return r.stdout.trim();
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  // git merge-base --is-ancestor returns 0 (success) if reachable, 1 otherwise.
  // gitOrThrow throws on non-zero, so wrap and inspect.
  try {
    await gitOrThrow(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
