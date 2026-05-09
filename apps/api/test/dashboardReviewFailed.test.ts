import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  StepArtifactsRepo,
  TasksRepo,
  WorkflowRunsRepo,
  migrate,
} from "@agent-dock/db";
import { DashboardService } from "../src/services/dashboard.js";

let db: Database.Database;
let service: DashboardService;
let repos: {
  sessions: SessionsRepo;
  tasks: TasksRepo;
  projects: ProjectsRepo;
  pipelineSteps: PipelineStepsRepo;
  workflowRuns: WorkflowRunsRepo;
  stepArtifacts: StepArtifactsRepo;
};

interface ScenarioInput {
  status: "running" | "awaiting_approval" | "failed" | "completed";
  reviewVerdict?: { passed: boolean; summary: string } | null;
}

/**
 * Build the minimal {project, task, session, run, code_review step,
 * optional review_result artifact} graph the dashboard query joins
 * across. Returns the session id so callers can assert.
 */
function seedScenario(name: string, input: ScenarioInput): string {
  const project = repos.projects.create({ rootPath: `/tmp/${name}`, name });
  const task = repos.tasks.create({ projectId: project.id, title: name });
  const session = repos.sessions.create({
    taskId: task.id,
    baseRef: "main",
    branch: `agent-dock/${task.id}/${name}`,
    worktreePath: `/tmp/${name}-wt`,
  });
  if (input.status !== "running") {
    repos.sessions.update(session.id, { status: input.status });
  } else {
    repos.sessions.update(session.id, { status: "running" });
  }
  const run = repos.workflowRuns.create({ sessionId: session.id });
  const codeReviewStep = repos.pipelineSteps.create({
    runId: run.id,
    role: "code_review",
    ord: 3,
  });
  if (input.reviewVerdict) {
    repos.stepArtifacts.create({
      stepId: codeReviewStep.id,
      kind: "review_result",
      filePath: ".plan/review_result.json",
      preview: JSON.stringify(input.reviewVerdict),
    });
  }
  return session.id;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  repos = {
    sessions: new SessionsRepo(db),
    tasks: new TasksRepo(db),
    projects: new ProjectsRepo(db),
    pipelineSteps: new PipelineStepsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
    stepArtifacts: new StepArtifactsRepo(db),
  };
  service = new DashboardService({ db, ...repos });
});

afterEach(() => db?.close());

describe("DashboardService.summary — reviewFailed split", () => {
  it("returns reviewFailed=0 when no sessions exist", () => {
    expect(service.summary().reviewFailed).toBe(0);
  });

  it("counts an awaiting_approval session whose latest review_result has passed=false", () => {
    seedScenario("a", {
      status: "awaiting_approval",
      reviewVerdict: { passed: false, summary: "missing tests" },
    });
    const s = service.summary();
    expect(s.awaitingApproval).toBe(1);
    expect(s.reviewFailed).toBe(1);
  });

  it("does NOT count an awaiting_approval session whose review_result passed=true (fresh plan path)", () => {
    seedScenario("b", {
      status: "awaiting_approval",
      reviewVerdict: { passed: true, summary: "all good" },
    });
    const s = service.summary();
    expect(s.awaitingApproval).toBe(1);
    expect(s.reviewFailed).toBe(0);
  });

  it("does NOT count sessions that aren't awaiting_approval, even with passed=false artifacts", () => {
    seedScenario("c", {
      status: "running",
      reviewVerdict: { passed: false, summary: "fail mid-flight" },
    });
    seedScenario("d", {
      status: "failed",
      reviewVerdict: { passed: false, summary: "stuck" },
    });
    seedScenario("e", {
      status: "completed",
      reviewVerdict: { passed: true, summary: "done" },
    });
    expect(service.summary().reviewFailed).toBe(0);
  });

  it("counts both awaiting_approval-with-failed-verdict and awaiting_approval-without-verdict together correctly", () => {
    seedScenario("f", {
      status: "awaiting_approval",
      reviewVerdict: { passed: false, summary: "issue 1" },
    });
    seedScenario("g", {
      status: "awaiting_approval",
      reviewVerdict: null, // first plan gate, no review yet
    });
    const s = service.summary();
    expect(s.awaitingApproval).toBe(2);
    expect(s.reviewFailed).toBe(1);
  });
});
