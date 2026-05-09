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
let runner: PackCapturingRunner;
let taskId: string;

class PackCapturingRunner implements StepRunner {
  /** Per-role snapshot of the pack each role saw at run time. */
  packsByRole: Record<string, string> = {};

  async run(input: StepRunnerInput): Promise<StepRunnerResult> {
    input.onEvent({ kind: "agent", payload: { type: "init" } });
    this.packsByRole[input.role.role] = input.prompt;
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
    return {
      status: "completed",
      threadId: `${input.role.role}-thread`,
      finalText: "## findings\nok\n",
    };
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-packref-"));
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
  const task = repos.tasks.create({
    projectId: project.id,
    title: "Refresh pack between roles",
    descriptionMd: "Make every role get its own role-brief in the pack.",
  });
  taskId = task.id;

  eventBus = new EventBus();
  runner = new PackCapturingRunner();
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

describe("Pack refresh on auto-advance (regression)", () => {
  it("each role's run sees a pack whose Role-brief names that role (investigate→clarify→plan)", async () => {
    const start = await coordinator.start(taskId);
    await waitFor(
      () => sessionStatus(db, start.sessionId) === "awaiting_approval",
      8000,
    );

    expect(runner.packsByRole.investigate).toBeTruthy();
    expect(runner.packsByRole.clarify).toBeTruthy();
    expect(runner.packsByRole.plan).toBeTruthy();

    // Each role gets ITS OWN role brief — not investigate's, which was
    // the regression.
    expect(runner.packsByRole.investigate).toMatch(/Role: investigate/);
    expect(runner.packsByRole.clarify).toMatch(/Role: clarify/);
    expect(runner.packsByRole.plan).toMatch(/Role: plan/);

    // Task description shows up in every role's pack — this was the
    // user-reported "no task description" symptom.
    for (const role of ["investigate", "clarify", "plan"] as const) {
      expect(runner.packsByRole[role]).toContain(
        "Make every role get its own role-brief",
      );
    }

    // After investigate completes, downstream roles see findings.md as
    // an upstream artifact — the second auto-advance refresh-trigger.
    expect(runner.packsByRole.clarify).toContain("# Upstream artifacts");
    expect(runner.packsByRole.clarify).toContain("findings");
    expect(runner.packsByRole.plan).toContain("# Upstream artifacts");

    // The on-disk PACK.md after the pipeline reaches awaiting_approval
    // reflects the LAST refresh (plan's role brief).
    const packOnDisk = readFileSync(
      join(start.worktreePath, ".context", "PACK.md"),
      "utf8",
    );
    expect(packOnDisk).toMatch(/Role: plan/);

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
