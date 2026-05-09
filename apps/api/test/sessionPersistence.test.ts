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
import type {
  StepRunner,
  StepRunnerInput,
  StepRunnerResult,
} from "@agent-dock/agents";
import { EventBus, WorkflowCoordinator } from "@agent-dock/orchestrator";
import { featureFlow } from "@agent-dock/workflows";
import { WorktreeManager, gitOrThrow } from "@agent-dock/worktrees";

/**
 * Defensive test for the user-reported "leaving the page seems to
 * cancel the task" symptom. The orchestrator publishes through an
 * EventBus that has no awareness of HTTP/SSE; subscribers come and go,
 * the coordinator does not. This test asserts that.
 *
 * If a future regression accidentally couples coordinator progression
 * to subscriber count (e.g. via back-pressure that pauses on no-listeners),
 * this test fails.
 */

let tmp: string;
let db: Database.Database;
let coordinator: WorkflowCoordinator;
let eventBus: EventBus;
let projectRoot: string;
let taskId: string;

class FastRunner implements StepRunner {
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });
    // Phase 33: clarify and validate need structured JSON output so the
    // coordinator's role-completion router auto-advances them. Default
    // to all_clear / passed=true so the pipeline runs through to
    // completion without pausing for user input.
    if (input.role.role === "clarify") {
      const json = { status: "all_clear" };
      return {
        status: "completed",
        threadId: `tid-${input.role.role}`,
        finalText: JSON.stringify(json),
        json,
      };
    }
    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      return {
        status: "completed",
        threadId: `tid-${input.role.role}`,
        finalText: JSON.stringify(json),
        json,
      };
    }
    if (input.role.role === "plan") {
      // Phase 36/37: plan must emit a schema-valid JSON object so the
      // orchestrator routes to awaiting_approval, not a gaps-blocked
      // path or a parse failure.
      const json = {
        task_summary:
          "Drive the FastRunner pipeline through plan with a schema-clean structured plan.",
        acceptance_criteria: [
          { id: "AC1", text: "FastRunner reaches awaiting_approval after plan." },
        ],
        phases: [
          {
            id: "P1",
            title: "noop",
            goal: "Make the pipeline reach awaiting_approval without any code edits.",
            files: ["README.md"],
            done_when:
              "Coordinator post-completion router routes plan to awaiting_approval.",
            covers_acceptance: ["AC1"],
          },
        ],
        open_questions: [],
        out_of_scope: [],
      };
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        threadId: `tid-${input.role.role}`,
        finalText,
        json,
      };
    }
    const finalText =
      input.role.role === "code_review"
        ? JSON.stringify({ passed: true, summary: "ok", issues: [] })
        : "## Summary\nfast\n";
    input.onEvent({
      kind: "agent",
      payload: { type: "message", role: "assistant", text: finalText },
    });
    return {
      status: "completed",
      threadId: `tid-${input.role.role}`,
      finalText,
      json:
        input.role.role === "code_review"
          ? { passed: true, summary: "ok", issues: [] }
          : undefined,
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-persist-"));
  const workspaceDir = join(tmp, "ws");
  projectRoot = join(workspaceDir, "repo");
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
  const project = repos.projects.create({ rootPath: projectRoot, name: "repo" });
  const task = repos.tasks.create({ projectId: project.id, title: "Task" });
  taskId = task.id;

  eventBus = new EventBus();
  coordinator = new WorkflowCoordinator({
    repos,
    worktrees: new WorktreeManager(),
    runner: new FastRunner(),
    workflow: featureFlow,
    eventBus,
    workspaceDir,
  });
});

afterEach(() => {
  db?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("session persistence after subscriber disconnect", () => {
  it("coordinator advances investigate→plan→awaiting_approval even after the only event-bus subscriber unsubscribes", async () => {
    const start = await coordinator.start(taskId);

    // Subscribe (simulating an SSE client opening) and immediately
    // unsubscribe (simulating navigating away). Buffer received events
    // for a sanity assertion.
    const received: number[] = [];
    const unsub = eventBus.subscribe(start.sessionId, () => received.push(Date.now()));
    unsub();

    // Wait for the coordinator to land in awaiting_approval — proves
    // it ran investigate + plan in the absence of any subscriber.
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );
    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_approval");

    // No events should have been delivered after unsubscribe (the bus
    // is fan-out-on-publish; we only count the gap between subscribe
    // and unsubscribe, which is effectively zero).
    expect(received.length).toBeLessThanOrEqual(1);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("coordinator runs the full pipeline to completion with no subscribers ever attached", async () => {
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
    expect(sessionStatus(db, start.sessionId)).toBe("completed");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });
});

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

function sessionStatus(db: Database.Database, id: string): string {
  return (db.prepare("SELECT status FROM sessions WHERE id = ?").get(id) as { status: string }).status;
}

function sessionBranch(db: Database.Database, id: string): string {
  return (db.prepare("SELECT branch FROM sessions WHERE id = ?").get(id) as { branch: string }).branch;
}
