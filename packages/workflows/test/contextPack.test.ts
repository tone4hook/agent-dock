import { describe, expect, it } from "vitest";
import {
  ATLASSIAN_ITEM_BYTE_BUDGET,
  buildContextPack,
  investigateRole,
  type ContextPackInput,
} from "../src/index.js";

function fixture(overrides: Partial<ContextPackInput> = {}): ContextPackInput {
  return {
    project: {
      name: "demo",
      rootPath: "/tmp/demo",
      defaultBaseRef: "main",
    },
    task: {
      title: "Add posthog tracking",
      descriptionMd: "Mirror the rule-deleted pattern.",
      status: "in_progress",
    },
    jiraLinks: [
      {
        jiraKey: "ENG-1",
        role: "spec",
        summary: "First issue",
        status: "Open",
        descriptionMd: "## desc 1",
        notesMd: "local note 1",
      },
      {
        jiraKey: "ENG-2",
        role: "context",
        summary: "Second issue",
        status: "In Progress",
        descriptionMd: "## desc 2",
        notesMd: null,
      },
    ],
    confluenceLinks: [
      {
        pageId: "p1",
        role: "spec",
        title: "Conventions",
        bodyMd: "Use tabs, not spaces.",
        notesMd: "important",
      },
      {
        pageId: "p2",
        role: "",
        title: "Glossary",
        bodyMd: "term -> meaning",
        notesMd: null,
      },
    ],
    metaContexts: [
      {
        scopeType: "task",
        scopeId: "task-A",
        kind: "manual",
        bodyMd: "task note",
      },
    ],
    priorStepArtifacts: [],
    role: investigateRole,
    ...overrides,
  };
}

describe("buildContextPack", () => {
  it("renders all sections in stable order", () => {
    const { markdown } = buildContextPack(fixture());
    const headings = [...markdown.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Project",
      "Task",
      "Linked Jira issues",
      "Linked Confluence pages",
      "Meta-context notes",
      "Role brief",
    ]);
    expect(markdown.includes("ENG-1")).toBe(true);
    expect(markdown.includes("ENG-2")).toBe(true);
    expect(markdown.includes("p1")).toBe(true);
    expect(markdown.includes("p2")).toBe(true);
    expect(markdown.includes("task note")).toBe(true);
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("omits empty sections but keeps order", () => {
    const { markdown } = buildContextPack(
      fixture({ jiraLinks: [], confluenceLinks: [], metaContexts: [] }),
    );
    const headings = [...markdown.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Project", "Task", "Role brief"]);
  });

  it("includes Upstream artifacts when present", () => {
    const { markdown } = buildContextPack(
      fixture({
        priorStepArtifacts: [
          { kind: "findings", filePath: ".plan/findings.md", preview: "summary line" },
        ],
      }),
    );
    expect(markdown).toMatch(/# Upstream artifacts\n\n## findings\n\n- Path: \.plan\/findings\.md/);
    expect(markdown.includes("summary line")).toBe(true);
  });

  it("truncates per-item ADF body to the byte budget", () => {
    const huge = "x".repeat(ATLASSIAN_ITEM_BYTE_BUDGET * 2);
    const { markdown } = buildContextPack(
      fixture({
        jiraLinks: [
          {
            jiraKey: "ENG-9",
            role: "spec",
            summary: "huge",
            status: "Open",
            descriptionMd: huge,
            notesMd: null,
          },
        ],
        confluenceLinks: [],
        metaContexts: [],
      }),
    );
    expect(markdown.includes("…(truncated)")).toBe(true);
    // The unbounded huge body would be 2*budget bytes; truncation keeps
    // it under (budget + small overhead for headings + marker).
    const xCount = (markdown.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThan(ATLASSIAN_ITEM_BYTE_BUDGET + 1024);
  });

  it("renders clarification_answers newest-first under a supersession heading with Round labels and timestamps", () => {
    const { markdown } = buildContextPack(
      fixture({
        metaContexts: [
          {
            scopeType: "task",
            scopeId: "T",
            kind: "clarification_answers",
            bodyMd: "Round-1 body: spacing only",
            createdAt: "2026-05-06T10:00:00Z",
          },
          {
            scopeType: "task",
            scopeId: "T",
            kind: "clarification_answers",
            bodyMd: "Round-2 body: actually MFE federation",
            createdAt: "2026-05-06T11:00:00Z",
          },
          {
            scopeType: "task",
            scopeId: "T",
            kind: "clarification_answers",
            bodyMd: "Round-3 body: keep MFE, target /reports",
            createdAt: "2026-05-06T12:00:00Z",
          },
        ],
      }),
    );
    expect(markdown).toContain(
      "## clarification_answers (most recent first — later rounds supersede earlier)",
    );
    // Round 3 (newest) should appear BEFORE Round 1 (oldest) in the rendered text.
    const r3Index = markdown.indexOf("Round 3");
    const r2Index = markdown.indexOf("Round 2");
    const r1Index = markdown.indexOf("Round 1");
    expect(r3Index).toBeGreaterThan(-1);
    expect(r2Index).toBeGreaterThan(-1);
    expect(r1Index).toBeGreaterThan(-1);
    expect(r3Index).toBeLessThan(r2Index);
    expect(r2Index).toBeLessThan(r1Index);
    // Body text from each round still shows up.
    expect(markdown).toContain("Round-3 body: keep MFE, target /reports");
    expect(markdown).toContain("Round-1 body: spacing only");
    // Timestamps are surfaced in the headings.
    expect(markdown).toMatch(/Round 3 — 2026-05-06T12:00:00Z/);
  });

  it("renders reviewer_feedback newest-first with Round labels (rejection rounds)", () => {
    const { markdown } = buildContextPack(
      fixture({
        metaContexts: [
          {
            scopeType: "session",
            scopeId: "step-1",
            kind: "reviewer_feedback",
            bodyMd: "Reject 1: missing files list",
            createdAt: "2026-05-06T10:00:00Z",
          },
          {
            scopeType: "session",
            scopeId: "step-1",
            kind: "reviewer_feedback",
            bodyMd: "Reject 2: scope is wrong, restart",
            createdAt: "2026-05-06T11:00:00Z",
          },
        ],
      }),
    );
    expect(markdown).toContain(
      "## reviewer_feedback (most recent first — later rounds supersede earlier)",
    );
    const r2 = markdown.indexOf("Reject 2");
    const r1 = markdown.indexOf("Reject 1");
    expect(r2).toBeGreaterThan(-1);
    expect(r1).toBeGreaterThan(-1);
    expect(r2).toBeLessThan(r1);
  });

  it("preserves the ordering of non-superseding meta-context kinds (e.g. 'manual' notes)", () => {
    const { markdown } = buildContextPack(
      fixture({
        metaContexts: [
          {
            scopeType: "task",
            scopeId: "T",
            kind: "manual",
            bodyMd: "first manual note",
          },
          {
            scopeType: "task",
            scopeId: "T",
            kind: "manual",
            bodyMd: "second manual note",
          },
          {
            scopeType: "task",
            scopeId: "T",
            kind: "clarification_answers",
            bodyMd: "Round-1 only answer",
            createdAt: "2026-05-06T10:00:00Z",
          },
        ],
      }),
    );
    // Manual notes preserve input order.
    const firstIdx = markdown.indexOf("first manual note");
    const secondIdx = markdown.indexOf("second manual note");
    expect(firstIdx).toBeLessThan(secondIdx);
    // Manual section appears BEFORE the supersession section.
    const supersessionHeading = markdown.indexOf("## clarification_answers (most recent first");
    expect(secondIdx).toBeLessThan(supersessionHeading);
  });

  it("renders the role brief with model + tools + expected artifacts", () => {
    const { markdown } = buildContextPack(fixture());
    expect(markdown).toMatch(/- Role: investigate/);
    expect(markdown).toMatch(/- Model: claude-sonnet-4-6/);
    expect(markdown).toMatch(/- Permission mode: bypassPermissions/);
    expect(markdown).toMatch(/- Allowed tools: Read, Grep, Glob, WebFetch/);
    expect(markdown).toMatch(/- Expected artifacts: \.plan\/findings\.md/);
  });
});
