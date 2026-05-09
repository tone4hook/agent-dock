import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchExists, gitOrThrow, refExists } from "../src/git.js";
import { WorktreeManager } from "../src/manager.js";

let tmp: string;
let projectRoot: string;
let workspaceDir: string;
const manager = new WorktreeManager();

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ad-wt-"));
  projectRoot = join(tmp, "project");
  workspaceDir = join(tmp, "ws");
  await initRepo(projectRoot);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function initRepo(root: string, branch = "main") {
  await gitOrThrow(tmp, ["init", "-q", "-b", branch, root]);
  // identity is required for commits in CI-like environments
  await gitOrThrow(root, ["config", "user.email", "test@example.com"]);
  await gitOrThrow(root, ["config", "user.name", "Test"]);
  writeFileSync(join(root, "README.md"), "hello\n");
  await gitOrThrow(root, ["add", "."]);
  await gitOrThrow(root, ["commit", "-q", "-m", "init"]);
}

describe("WorktreeManager.create + remove", () => {
  it("creates a worktree on the agent-dock branch and removes it cleanly", async () => {
    const result = await manager.create({
      projectRoot,
      projectId: "proj-1",
      taskId: "task-A",
      sessionId: "sess-1",
      workspaceDir,
    });

    expect(result.branch).toBe("agent-dock/task-A/sess-1");
    expect(result.baseRef).toBe("main");
    expect(result.worktreePath).toBe(
      realpathSync(resolve(workspaceDir, "worktrees", "proj-1", "sess-1")),
    );
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(existsSync(join(result.worktreePath, "README.md"))).toBe(true);
    expect(await branchExists(projectRoot, result.branch)).toBe(true);

    const live = await manager.list(projectRoot);
    const matched = live.find((w) => w.path === result.worktreePath);
    expect(matched?.branch).toBe(result.branch);

    await manager.remove({
      projectRoot,
      worktreePath: result.worktreePath,
      branch: result.branch,
    });

    expect(existsSync(result.worktreePath)).toBe(false);
    expect(await branchExists(projectRoot, result.branch)).toBe(false);
  });

  it("base-ref fallback prefers main, then master", async () => {
    // main exists from beforeEach.
    const a = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tA",
      sessionId: "s1",
      workspaceDir,
    });
    expect(a.baseRef).toBe("main");
    await manager.remove({ projectRoot, worktreePath: a.worktreePath, branch: a.branch });

    // master-only repo: rename current branch.
    await gitOrThrow(projectRoot, ["branch", "-m", "main", "master"]);
    expect(await refExists(projectRoot, "main")).toBe(false);
    expect(await refExists(projectRoot, "master")).toBe(true);

    const b = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tB",
      sessionId: "s2",
      workspaceDir,
    });
    expect(b.baseRef).toBe("master");
  });

  it("explicit baseRef is honored, missing baseRef errors", async () => {
    await gitOrThrow(projectRoot, ["checkout", "-q", "-b", "feature/x"]);
    await gitOrThrow(projectRoot, ["checkout", "-q", "main"]);

    const ok = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tC",
      sessionId: "s3",
      workspaceDir,
      baseRef: "feature/x",
    });
    expect(ok.baseRef).toBe("feature/x");
    await manager.remove({ projectRoot, worktreePath: ok.worktreePath, branch: ok.branch });

    await expect(
      manager.create({
        projectRoot,
        projectId: "p",
        taskId: "tD",
        sessionId: "s4",
        workspaceDir,
        baseRef: "no-such-branch",
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("create rejects duplicate branch or duplicate path", async () => {
    const a = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tE",
      sessionId: "s5",
      workspaceDir,
    });

    // duplicate branch
    await expect(
      manager.create({
        projectRoot,
        projectId: "p2",
        taskId: "tE",
        sessionId: "s5",
        workspaceDir,
      }),
    ).rejects.toThrow(/Branch already exists/);

    await manager.remove({ projectRoot, worktreePath: a.worktreePath, branch: a.branch });
  });

  it("findOrphans surfaces on-disk worktrees the host did not register", async () => {
    const ghost = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tF",
      sessionId: "s6",
      workspaceDir,
    });

    // Host didn't tell us about it.
    const reportEmpty = await manager.findOrphans({
      projectRoot,
      knownPaths: [],
    });
    expect(reportEmpty.onDiskOnly.map((w) => resolve(w.path))).toContain(
      resolve(ghost.worktreePath),
    );

    // Host claims a path that doesn't exist.
    const reportKnown = await manager.findOrphans({
      projectRoot,
      knownPaths: [join(tmp, "ws/worktrees/p/zombie")],
    });
    expect(reportKnown.knownOnly).toContain(join(tmp, "ws/worktrees/p/zombie"));

    await manager.remove({
      projectRoot,
      worktreePath: ghost.worktreePath,
      branch: ghost.branch,
    });
  });

  it("remove is idempotent when path or branch is already gone", async () => {
    const r = await manager.create({
      projectRoot,
      projectId: "p",
      taskId: "tG",
      sessionId: "s7",
      workspaceDir,
    });
    await manager.remove({
      projectRoot,
      worktreePath: r.worktreePath,
      branch: r.branch,
    });
    // Calling again should not throw.
    await expect(
      manager.remove({
        projectRoot,
        worktreePath: r.worktreePath,
        branch: r.branch,
      }),
    ).resolves.toBeUndefined();
  });
});
