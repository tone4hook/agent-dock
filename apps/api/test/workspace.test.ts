import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, ProjectsRepo, SettingsRepo } from "@agent-dock/db";
import { WorkspaceService } from "../src/services/workspace.js";

let db: Database.Database;
let tmp: string;
let svc: WorkspaceService;

function makeRepo(name: string): string {
  const root = join(tmp, name);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  tmp = mkdtempSync(join(tmpdir(), "agent-dock-ws-"));
  svc = new WorkspaceService({
    settings: new SettingsRepo(db),
    projects: new ProjectsRepo(db),
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("WorkspaceService", () => {
  it("setWorkspaceDir auto-discovers one-level git repos", () => {
    makeRepo("alpha");
    makeRepo("beta");
    // Directories that should be skipped:
    mkdirSync(join(tmp, "worktrees"));
    mkdirSync(join(tmp, "node_modules"));
    mkdirSync(join(tmp, "not-a-repo"));

    const state = svc.setWorkspaceDir(tmp);
    expect(state.workspaceDir).toBe(tmp);
    const names = state.projects.map((p) => p.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("rescan picks up newly added repos without duplicating existing ones", () => {
    makeRepo("alpha");
    svc.setWorkspaceDir(tmp);
    expect(svc.getState().projects).toHaveLength(1);

    makeRepo("beta");
    const after = svc.discoverProjects(tmp);
    expect(after.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);

    // Re-running discovery is idempotent.
    const again = svc.discoverProjects(tmp);
    expect(again).toHaveLength(2);
  });

  it("addProject manually registers a path outside workspaceDir", () => {
    const otherTmp = mkdtempSync(join(tmpdir(), "agent-dock-other-"));
    try {
      mkdirSync(join(otherTmp, ".git"));
      writeFileSync(join(otherTmp, ".git", "HEAD"), "ref: refs/heads/main\n");
      const project = svc.addProject(otherTmp, "external");
      expect(project.name).toBe("external");
      expect(project.rootPath).toBe(otherTmp);
      // Adding the same path again returns the existing row.
      const dup = svc.addProject(otherTmp);
      expect(dup.id).toBe(project.id);
    } finally {
      rmSync(otherTmp, { recursive: true, force: true });
    }
  });

  it("setWorkspaceDir rejects non-existent directories", () => {
    expect(() => svc.setWorkspaceDir(join(tmp, "nope"))).toThrow(/does not exist/);
  });

  it("addProject rejects non-git directories", () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    expect(() => svc.addProject(plain)).toThrow(/not a git repo/);
  });
});
