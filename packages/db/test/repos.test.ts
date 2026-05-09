import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.js";
import { ProjectsRepo } from "../src/repos/projects.js";
import { TaskLinksRepo, TasksRepo } from "../src/repos/tasks.js";
import { AtlassianCacheRepo } from "../src/repos/atlassian.js";
import { MetaContextsRepo } from "../src/repos/metaContexts.js";
import { SessionsRepo } from "../src/repos/sessions.js";
import { PipelineStepsRepo, WorkflowRunsRepo } from "../src/repos/workflows.js";
import { StepArtifactsRepo, StepEventsRepo } from "../src/repos/stepEvents.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe("ProjectsRepo", () => {
  it("creates, lists, finds, updates, archives", () => {
    const repo = new ProjectsRepo(db);
    const p = repo.create({ rootPath: "/tmp/proj-a", name: "proj-a" });
    expect(p.name).toBe("proj-a");
    expect(p.defaultBaseRef).toBe("main");

    expect(repo.findByRootPath("/tmp/proj-a")?.id).toBe(p.id);
    expect(repo.list().map((x) => x.id)).toEqual([p.id]);

    repo.update(p.id, { name: "proj-renamed", defaultBaseRef: "master" });
    expect(repo.get(p.id)?.name).toBe("proj-renamed");
    expect(repo.get(p.id)?.defaultBaseRef).toBe("master");

    repo.update(p.id, { archived: true });
    expect(repo.list()).toHaveLength(0);
    expect(repo.list({ includeArchived: true })).toHaveLength(1);
  });
});

describe("TasksRepo + TaskLinksRepo", () => {
  it("creates tasks, links jira/confluence, cascades on task delete", () => {
    const projects = new ProjectsRepo(db);
    const tasks = new TasksRepo(db);
    const links = new TaskLinksRepo(db);
    const atlassian = new AtlassianCacheRepo(db);

    const p = projects.create({ rootPath: "/tmp/proj-b", name: "proj-b" });
    const t = tasks.create({ projectId: p.id, title: "Build a thing" });
    expect(t.status).toBe("open");

    atlassian.upsertJiraIssue("PROJ-1", { fields: { summary: "x" } });
    atlassian.upsertConfluencePage("page-1", { title: "y" });

    links.addJira({ taskId: t.id, jiraKey: "PROJ-1", role: "spec" });
    links.addConfluence({ taskId: t.id, pageId: "page-1", role: "context" });
    expect(links.listJira(t.id)).toHaveLength(1);
    expect(links.listConfluence(t.id)).toHaveLength(1);

    tasks.update(t.id, { status: "in_progress" });
    expect(tasks.get(t.id)?.status).toBe("in_progress");

    tasks.delete(t.id);
    expect(links.listJira(t.id)).toHaveLength(0);
    expect(links.listConfluence(t.id)).toHaveLength(0);

    // Atlassian cache rows survive task deletion.
    expect(atlassian.getJiraIssue("PROJ-1")).not.toBeNull();
    expect(atlassian.getConfluencePage("page-1")).not.toBeNull();
  });
});

describe("AtlassianCacheRepo", () => {
  it("upserts payloads + manages context notes", () => {
    const repo = new AtlassianCacheRepo(db);

    repo.upsertJiraIssue("ABC-1", { fields: { summary: "first" } });
    expect(JSON.parse(repo.getJiraIssue("ABC-1")!.payloadJson).fields.summary).toBe("first");
    expect(repo.getJiraIssueContext("ABC-1")?.notesMd).toBe("");

    repo.setJiraIssueContext("ABC-1", "## notes");
    expect(repo.getJiraIssueContext("ABC-1")?.notesMd).toBe("## notes");

    repo.upsertJiraIssue("ABC-1", { fields: { summary: "second" } });
    expect(JSON.parse(repo.getJiraIssue("ABC-1")!.payloadJson).fields.summary).toBe("second");
    // context survives upsert
    expect(repo.getJiraIssueContext("ABC-1")?.notesMd).toBe("## notes");

    repo.upsertConfluencePage("p1", { title: "a" });
    repo.setConfluencePageContext("p1", "page notes");
    expect(repo.getConfluencePageContext("p1")?.notesMd).toBe("page notes");

    // Cascade: deleting page cascades context
    repo.deleteConfluencePage("p1");
    expect(repo.getConfluencePage("p1")).toBeNull();
    expect(repo.getConfluencePageContext("p1")).toBeNull();
  });
});

describe("MetaContextsRepo", () => {
  it("CRUDs scoped meta-contexts", () => {
    const repo = new MetaContextsRepo(db);
    const m = repo.create({
      scopeType: "task",
      scopeId: "task-1",
      kind: "manual",
      bodyMd: "hello",
    });
    expect(repo.listForScope("task", "task-1")).toHaveLength(1);
    repo.update(m.id, "hello world");
    expect(repo.get(m.id)?.bodyMd).toBe("hello world");
    repo.delete(m.id);
    expect(repo.listForScope("task", "task-1")).toHaveLength(0);
  });
});

describe("SessionsRepo + WorkflowRunsRepo + PipelineStepsRepo + StepEvents/Artifacts", () => {
  it("creates the full nested chain and cascades on session delete", () => {
    const projects = new ProjectsRepo(db);
    const tasks = new TasksRepo(db);
    const sessions = new SessionsRepo(db);
    const runs = new WorkflowRunsRepo(db);
    const steps = new PipelineStepsRepo(db);
    const events = new StepEventsRepo(db);
    const artifacts = new StepArtifactsRepo(db);

    const p = projects.create({ rootPath: "/tmp/proj-c", name: "proj-c" });
    const t = tasks.create({ projectId: p.id, title: "T" });

    const s = sessions.create({
      taskId: t.id,
      baseRef: "main",
      branch: `agent-dock/${t.id}/sessX`,
      worktreePath: "/tmp/wt",
    });
    expect(s.status).toBe("draft");
    expect(sessions.countActive()).toBe(0);

    sessions.update(s.id, { status: "running", startedAt: new Date().toISOString() });
    expect(sessions.countActive()).toBe(1);

    const run = runs.create({ sessionId: s.id });
    expect(run.workflowDefId).toBe("feature-flow");
    expect(runs.listForSession(s.id)).toHaveLength(1);

    const step = steps.create({ runId: run.id, ord: 0, role: "investigate" });
    expect(step.dependsOn).toEqual([]);
    expect(step.runner).toBe("host");

    const step2 = steps.create({
      runId: run.id,
      ord: 1,
      role: "plan",
      dependsOn: [step.id],
    });
    expect(step2.dependsOn).toEqual([step.id]);
    expect(steps.listForRun(run.id)).toHaveLength(2);

    steps.update(step.id, { status: "running", threadId: "thread-uuid" });
    expect(steps.get(step.id)?.threadId).toBe("thread-uuid");

    events.append({ stepId: step.id, kind: "started", payload: { at: 1 } });
    events.append({ stepId: step.id, kind: "log", payload: "hello" });
    expect(events.listForStep(step.id)).toHaveLength(2);

    artifacts.create({
      stepId: step.id,
      kind: "findings",
      filePath: "/tmp/findings.md",
      preview: "summary",
    });
    expect(artifacts.listForStep(step.id)).toHaveLength(1);

    // Cascade: deleting session removes runs, steps, events, artifacts.
    sessions.delete(s.id);
    expect(runs.get(run.id)).toBeNull();
    expect(steps.get(step.id)).toBeNull();
    expect(events.listForStep(step.id)).toHaveLength(0);
    expect(artifacts.listForStep(step.id)).toHaveLength(0);
  });

  it("Phase 40 — step_artifacts.kind accepts plan_structured + plan_gaps and deleteByKind clears the matching rows", () => {
    const projects = new ProjectsRepo(db);
    const tasks = new TasksRepo(db);
    const sessions = new SessionsRepo(db);
    const runs = new WorkflowRunsRepo(db);
    const steps = new PipelineStepsRepo(db);
    const artifacts = new StepArtifactsRepo(db);

    const p = projects.create({ rootPath: "/tmp/proj-p40", name: "proj-p40" });
    const t = tasks.create({ projectId: p.id, title: "T-p40" });
    const s = sessions.create({
      taskId: t.id,
      baseRef: "main",
      branch: `agent-dock/${t.id}/p40`,
      worktreePath: "/tmp/wt-p40",
    });
    const run = runs.create({ sessionId: s.id });
    const planStep = steps.create({ runId: run.id, ord: 0, role: "plan" });
    const clarifyStep = steps.create({ runId: run.id, ord: 1, role: "clarify" });

    // The new kinds Phase 36/37 introduced — plan_structured (Phase 36's
    // structured-plan artifact) and plan_gaps (Phase 37's Zod-error
    // bullet list) — round-trip through StepArtifactsRepo cleanly. The
    // step_artifacts.kind column has no CHECK constraint so the migration
    // 007 originally scoped for Phase 40 was a no-op; this test guards
    // against a future tightening that would re-enforce the CHECK.
    artifacts.create({
      stepId: planStep.id,
      kind: "plan_structured",
      filePath: "/tmp/wt-p40/.plan/plan.json",
      preview: '{"task_summary":"x"}',
    });
    artifacts.create({
      stepId: planStep.id,
      kind: "plan_gaps",
      filePath: "/tmp/wt-p40/.plan/plan.json",
      preview: "- phases.0.done_when: vague",
    });
    expect(artifacts.listForStep(planStep.id).map((a) => a.kind).sort()).toEqual([
      "plan_gaps",
      "plan_structured",
    ]);

    // deleteByKind: surgical, scoped to {step, kind}. Phase 37's
    // clarify-auto-route relies on this when the planner re-emits
    // open_questions — the prior clarify_questions artifact must clear
    // before the new one persists, otherwise submitClarificationAnswers
    // picks up the stale set.
    artifacts.create({
      stepId: clarifyStep.id,
      kind: "clarify_questions",
      filePath: "/tmp/wt-p40/.plan/clarify.json",
      preview: '[{"id":"q1","text":"old"}]',
    });
    expect(artifacts.listForStep(clarifyStep.id)).toHaveLength(1);
    const removed = artifacts.deleteByKind(clarifyStep.id, "clarify_questions");
    expect(removed).toBe(1);
    expect(artifacts.listForStep(clarifyStep.id)).toHaveLength(0);
    // No-op when no matching rows.
    expect(artifacts.deleteByKind(clarifyStep.id, "clarify_questions")).toBe(0);
  });

  it("session cascades when parent task is deleted", () => {
    const projects = new ProjectsRepo(db);
    const tasks = new TasksRepo(db);
    const sessions = new SessionsRepo(db);

    const p = projects.create({ rootPath: "/tmp/proj-d", name: "proj-d" });
    const t = tasks.create({ projectId: p.id, title: "T2" });
    const s = sessions.create({
      taskId: t.id,
      baseRef: "main",
      branch: `agent-dock/${t.id}/sess`,
      worktreePath: "/tmp/wt2",
    });

    tasks.delete(t.id);
    expect(sessions.get(s.id)).toBeNull();
  });
});
