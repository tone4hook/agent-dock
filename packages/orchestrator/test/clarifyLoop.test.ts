import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let runner: ClarifyRunner;
let taskId: string;

class ClarifyRunner implements StepRunner {
  /** When true, clarify returns needs_input + a single canned question. */
  needInput = true;
  questionId = "q1";
  questionText = "Which gap value?";
  questionDefault = "32px";

  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });

    if (input.role.role === "clarify") {
      const json = this.needInput
        ? {
            status: "needs_input",
            questions: [
              { id: this.questionId, text: this.questionText, default: this.questionDefault },
            ],
          }
        : { status: "all_clear" };
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return { status: "completed", threadId: "clarify-thread", finalText, json };
    }

    if (input.role.role === "validate") {
      const json = { passed: true, reason: "ok" };
      const finalText = JSON.stringify(json);
      return { status: "completed", threadId: "validate-thread", finalText, json };
    }

    if (input.role.role === "code_review") {
      const json = { passed: true, summary: "ok", issues: [] };
      const finalText = JSON.stringify(json);
      return { status: "completed", threadId: "review-thread", finalText, json };
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

    // investigate / implement: emit benign markdown output.
    const finalText = "## Summary\nok\n";
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
  tmp = mkdtempSync(join(tmpdir(), "ad-clarify-"));
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
  runner = new ClarifyRunner();
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

describe("Phase 33 — clarify loop", () => {
  it("clarify returns needs_input → session=awaiting_clarification with questions captured as step_artifact", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    // Investigate completed; clarify completed (the role finished — it's
    // the session that's paused, not the step). plan/implement/code_review
    // remain pending.
    expect(stepStatusList(db, start.sessionId).slice(0, 2)).toEqual([
      "completed",
      "completed",
    ]);
    expect(stepStatusList(db, start.sessionId).slice(2)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);

    const clarifyStep = stepRowByOrd(db, start.sessionId, 1);
    const artifacts = stepArtifactsForStep(db, clarifyStep.id);
    const questionsArtifact = artifacts.find((a) => a.kind === "clarify_questions");
    expect(questionsArtifact).toBeTruthy();
    const parsed = JSON.parse(questionsArtifact!.preview ?? "[]");
    expect(parsed).toEqual([
      { id: "q1", text: "Which gap value?", default: "32px" },
    ]);

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("submitClarificationAnswers persists task-scoped meta-context, advances to plan, and PACK.md picks up the answer", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    await coordinator.submitClarificationAnswers(start.sessionId, { q1: "32px" });
    // After answering, plan kicks off → validate auto-passes →
    // session lands in awaiting_approval.
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    // Meta-context persisted at task scope.
    const metaContexts = listMetaContextsForTask(db, taskId);
    const answersRow = metaContexts.find((m) => m.kind === "clarification_answers");
    expect(answersRow).toBeTruthy();
    expect(answersRow!.body_md).toContain("Which gap value?");
    expect(answersRow!.body_md).toContain("32px");

    // PACK.md (regenerated for the plan step) contains the answer body.
    const pack = readFileSync(join(start.worktreePath, ".context", "PACK.md"), "utf8");
    expect(pack).toContain("32px");
    expect(pack).toContain("clarification_answers");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("submitClarificationAnswers throws missing_answer when an id is unanswered", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    await expect(
      coordinator.submitClarificationAnswers(start.sessionId, {}),
    ).rejects.toThrow(/Missing answer for question q1/);

    // Session should still be in awaiting_clarification (no state change).
    expect(sessionStatus(db, start.sessionId)).toBe("awaiting_clarification");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("submitClarificationAnswers reads questions from the artifact's filePath, not the truncated 400-char preview", async () => {
    // Reproduce the field bug: 3 questions whose stringified JSON
    // exceeds 400 chars. previewOf truncates the preview mid-string so
    // JSON.parse(preview) throws — but the full JSON in `.plan/clarify.json`
    // (written by expectedArtifacts) is intact and submission must work.
    runner.needInput = true;
    runner.questionId = "q1";
    // Override the runner to return three questions with long texts.
    const longText = "A".repeat(180);
    const original = runner.run.bind(runner);
    runner.run = async (input) => {
      if (input.role.role !== "clarify") return original(input);
      const json = {
        status: "needs_input",
        questions: [
          { id: "q1", text: `Question one — ${longText}`, default: "default-1" },
          { id: "q2", text: `Question two — ${longText}`, default: "default-2" },
          { id: "q3", text: `Question three — ${longText}`, default: "default-3" },
        ],
      };
      const finalText = JSON.stringify(json);
      input.onEvent({
        kind: "agent",
        payload: { type: "message", role: "assistant", text: finalText },
      });
      return {
        status: "completed",
        finalText,
        json,
        threadId: "tid-clarify-long",
      };
    };

    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_clarification",
      8000,
    );

    // Verify the bug precondition: preview is truncated and unparseable.
    const clarifyStep = stepRowByOrd(db, start.sessionId, 1);
    const arts = stepArtifactsForStep(db, clarifyStep.id);
    const qArtifact = arts.find((a) => a.kind === "clarify_questions")!;
    expect(qArtifact.preview!.length).toBeLessThan(JSON.stringify({ status: "needs_input", questions: [] }).length + longText.length * 3);
    expect(() => JSON.parse(qArtifact.preview!)).toThrow();

    // Submission still succeeds because we now read the file.
    await coordinator.submitClarificationAnswers(start.sessionId, {
      q1: "answer-1",
      q2: "answer-2",
      q3: "answer-3",
    });
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    const metaContexts = listMetaContextsForTask(db, taskId);
    const answersRow = metaContexts.find((m) => m.kind === "clarification_answers");
    expect(answersRow).toBeTruthy();
    expect(answersRow!.body_md).toContain("answer-1");
    expect(answersRow!.body_md).toContain("answer-2");
    expect(answersRow!.body_md).toContain("answer-3");

    await new WorktreeManager().remove({
      projectRoot,
      worktreePath: start.worktreePath,
      branch: sessionBranch(db, start.sessionId),
    });
  });

  it("clarify returns all_clear → auto-advances through plan to awaiting_approval (no pause)", async () => {
    runner.needInput = false;
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    // Session never visited awaiting_clarification — verifiable by
    // absence of the clarify_questions artifact.
    const clarifyStep = stepRowByOrd(db, start.sessionId, 1);
    const artifacts = stepArtifactsForStep(db, clarifyStep.id);
    expect(artifacts.find((a) => a.kind === "clarify_questions")).toBeUndefined();

    // Pipeline state on awaiting_approval: investigate, clarify, plan
    // all completed; implement + code_review pending. (validate
    // reverted.)
    expect(stepStatusList(db, start.sessionId)).toEqual([
      "completed",
      "completed",
      "completed",
      "pending",
      "pending",
    ]);

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
function listMetaContextsForTask(d: Database.Database, tId: string): Array<{ kind: string; body_md: string }> {
  return d
    .prepare(
      "SELECT kind, body_md FROM meta_contexts WHERE scope_type = 'task' AND scope_id = ? ORDER BY created_at ASC",
    )
    .all(tId) as Array<{ kind: string; body_md: string }>;
}
