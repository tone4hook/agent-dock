import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AtlassianCacheRepo, migrate } from "@agent-dock/db";
import {
  ExplorationCoordinator,
  buildHaikuReference,
} from "../src/services/explorationCoordinator.js";
import type { ExplorationEvent } from "../src/services/explorationCoordinator.js";

let db: Database.Database;
let atlassianCache: AtlassianCacheRepo;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  atlassianCache = new AtlassianCacheRepo(db);
});

afterEach(() => {
  db.close();
});

describe("buildHaikuReference", () => {
  it("renders a Jira reference block from a cached issue payload", () => {
    atlassianCache.upsertJiraIssue("EEPD-114822", {
      detail: {
        summary: "Replace Reports iframe with Module Federation",
        status: "In Progress",
        descriptionMd: "Migrate the Reports page from iframe to a federated remote module.",
      },
    });

    const ref = buildHaikuReference("jira", "EEPD-114822", { atlassianCache });
    expect(ref).not.toBeNull();
    expect(ref!.markdown).toMatch(/EEPD-114822/);
    expect(ref!.markdown).toMatch(/Replace Reports iframe/);
    expect(ref!.markdown).toMatch(/In Progress/);
    expect(ref!.markdown).toMatch(/federated remote module/);
  });

  it("renders a Confluence reference block from a cached page payload", () => {
    atlassianCache.upsertConfluencePage("page-42", {
      detail: {
        title: "Module Federation Playbook",
        bodyMd: "## Overview\n\nA practical playbook for module federation.",
      },
    });

    const ref = buildHaikuReference("confluence", "page-42", { atlassianCache });
    expect(ref).not.toBeNull();
    expect(ref!.markdown).toMatch(/Module Federation Playbook/);
    expect(ref!.markdown).toMatch(/practical playbook/);
  });

  it("returns null when the cache has no payload for the given scope", () => {
    expect(buildHaikuReference("jira", "DOES-NOT-EXIST", { atlassianCache })).toBeNull();
    expect(buildHaikuReference("confluence", "missing-page", { atlassianCache })).toBeNull();
  });

  it("returns null for task and project scopes (deferred to v2)", () => {
    expect(buildHaikuReference("task", "any-id", { atlassianCache })).toBeNull();
    expect(buildHaikuReference("project", "any-id", { atlassianCache })).toBeNull();
  });

  it("truncates very long descriptions so the augmented prompt stays bounded", () => {
    const huge = "X".repeat(20000);
    atlassianCache.upsertJiraIssue("BIG-1", {
      detail: { summary: "Big", status: "Open", descriptionMd: huge },
    });
    const ref = buildHaikuReference("jira", "BIG-1", { atlassianCache });
    expect(ref).not.toBeNull();
    // ATLASSIAN_ITEM_BYTE_BUDGET is 6KB; the markdown should be well
    // under the raw descriptionMd size.
    expect(ref!.markdown.length).toBeLessThan(huge.length / 2);
  });
});

describe("ExplorationCoordinator with reference augmentation", () => {
  it("prepends the reference block to the runner's prompt for jira scope", async () => {
    atlassianCache.upsertJiraIssue("EEPD-114822", {
      detail: {
        summary: "Replace Reports iframe",
        status: "In Progress",
        descriptionMd: "Migrate the Reports page.",
      },
    });

    let capturedPrompt = "";
    const coordinator = new ExplorationCoordinator({
      atlassianCache,
      runner: async ({ prompt }) => {
        capturedPrompt = prompt;
        return { status: "completed", markdown: "ok" };
      },
    });

    const snap = coordinator.start({
      prompt: "Summarize the implementation approach.",
      workingDirectory: "/tmp",
      scopeType: "jira",
      scopeId: "EEPD-114822",
    });

    await waitForCompletion(coordinator, snap.id);

    expect(capturedPrompt).toMatch(/# Reference context/);
    expect(capturedPrompt).toMatch(/EEPD-114822/);
    expect(capturedPrompt).toMatch(/Migrate the Reports page/);
    expect(capturedPrompt).toMatch(/# Your task/);
    expect(capturedPrompt).toMatch(/Summarize the implementation approach/);
    // The user-visible snapshot keeps the ORIGINAL prompt (not the
    // augmented one) so the user can re-edit without ref noise.
    const after = coordinator.get(snap.id)!;
    expect(after.prompt).toBe("Summarize the implementation approach.");
  });

  it("emits a reference event with status=missing when no cached payload exists", async () => {
    const events: ExplorationEvent[] = [];
    let capturedPrompt = "";
    const coordinator = new ExplorationCoordinator({
      atlassianCache,
      runner: async ({ prompt }) => {
        capturedPrompt = prompt;
        return { status: "completed", markdown: "" };
      },
    });

    const snap = coordinator.start({
      prompt: "Investigate.",
      workingDirectory: "/tmp",
      scopeType: "jira",
      scopeId: "MISSING-1",
    });
    coordinator.subscribe(snap.id, (e) => events.push(e));
    // Replay events: subscribe gives back already-buffered ones.
    const replay = coordinator.subscribe(snap.id, () => {})!.replay;
    for (const e of replay) events.push(e);

    await waitForCompletion(coordinator, snap.id);

    // No reference block prepended.
    expect(capturedPrompt).toBe("Investigate.");
    // A reference event was emitted with status=missing.
    const refEvent = events.find((e) => e.kind === "reference");
    expect(refEvent).toBeTruthy();
    expect(refEvent!.payload).toMatchObject({
      status: "missing",
      scopeType: "jira",
      scopeId: "MISSING-1",
    });
  });

  it("passes prompt through unchanged for task scope (v1 deferred)", async () => {
    let capturedPrompt = "";
    const coordinator = new ExplorationCoordinator({
      atlassianCache,
      runner: async ({ prompt }) => {
        capturedPrompt = prompt;
        return { status: "completed", markdown: "" };
      },
    });

    const snap = coordinator.start({
      prompt: "Look at the code.",
      workingDirectory: "/tmp",
      scopeType: "task",
      scopeId: "task-1",
    });
    await waitForCompletion(coordinator, snap.id);

    expect(capturedPrompt).toBe("Look at the code.");
  });
});

async function waitForCompletion(
  coordinator: ExplorationCoordinator,
  id: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = coordinator.get(id);
    if (snap && (snap.status === "completed" || snap.status === "failed" || snap.status === "cancelled")) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Exploration ${id} did not complete within ${timeoutMs}ms`);
}
