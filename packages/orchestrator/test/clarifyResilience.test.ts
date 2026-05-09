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
let runner: ClarifyFailRunner;
let taskId: string;

class ClarifyFailRunner implements StepRunner {
  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });

    if (input.role.role === "clarify") {
      // Simulate the SDK runner's outputSchema parse failure: status=failed
      // with the canonical errorMessage and a non-empty finalText.
      return {
        status: "failed",
        threadId: "clarify-thread",
        finalText: "rambling text not in JSON shape",
        errorMessage: "outputSchema role returned non-JSON final text",
      };
    }

    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      return {
        status: "completed",
        threadId: "validate-thread",
        finalText: JSON.stringify(json),
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

    if (input.role.role === "plan") {
      const json = makePlanJson();
      const finalText = JSON.stringify(json);
      input.onEvent({ kind: "agent", payload: { type: "message", role: "assistant", text: finalText } });
      return { status: "completed", threadId: "plan-thread", finalText, json };
    }
    const finalText = "## Summary\nok\n";
    input.onEvent({ kind: "agent", payload: { type: "message", role: "assistant", text: finalText } });
    return { status: "completed", threadId: `${input.role.role}-thread`, finalText };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-clarifyfs-"));
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
  const task = repos.tasks.create({ projectId: project.id, title: "Test" });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new ClarifyFailRunner();
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

describe("Phase 34 — clarify fail-soft", () => {
  it("a clarify outputSchema parse failure does NOT fail the session — coordinator advances to plan as if all_clear", async () => {
    const start = await coordinator.start(taskId);

    // Session lands in awaiting_approval, not failed. clarify's parse
    // hiccup gets soft-fallen and the pipeline continues.
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_approval");

    // Clarify step persisted as completed (so findNextPendingStep advances
    // cleanly), with the diagnostic recorded as a step_event. 5-step
    // pipeline: investigate, clarify, plan all complete; implement + review
    // pending.
    expect(stepStatusList(db, start.sessionId).slice(0, 3)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);

    const clarifyStep = stepRowByOrd(db, start.sessionId, 1);
    const events = stepEventsForStep(db, clarifyStep.id);
    const failsoft = events.find((e) => e.kind === "clarify_failed_softfall");
    expect(failsoft).toBeTruthy();
    expect(failsoft!.payload_json).toContain(
      "outputSchema role returned non-JSON final text",
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
function stepRowByOrd(d: Database.Database, sessionId: string, ord: number): { id: string } {
  return d
    .prepare(
      `SELECT s.id FROM pipeline_steps s
       JOIN workflow_runs r ON s.run_id = r.id
       WHERE r.session_id = ? AND s.ord = ?`,
    )
    .get(sessionId, ord) as { id: string };
}
function stepEventsForStep(d: Database.Database, stepId: string): Array<{ kind: string; payload_json: string }> {
  return d
    .prepare("SELECT kind, payload_json FROM step_events WHERE step_id = ? ORDER BY id ASC")
    .all(stepId) as Array<{ kind: string; payload_json: string }>;
}
