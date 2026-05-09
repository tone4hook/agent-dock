import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  branchExists,
  gitOrThrow,
  refExists,
  runGit,
  worktreeList,
  type WorktreeListEntry,
} from "./git.js";

export interface CreateWorktreeInput {
  projectRoot: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  workspaceDir: string;
  /** When omitted, falls back to `main` then `master`. */
  baseRef?: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branch: string;
  baseRef: string;
}

export interface RemoveWorktreeInput {
  projectRoot: string;
  worktreePath: string;
  branch: string;
}

export interface ListOrphansInput {
  projectRoot: string;
  /** Worktree paths the host knows about (i.e., DB-backed). */
  knownPaths: string[];
}

export interface OrphanReport {
  /** Paths git knows about but the host doesn't. */
  onDiskOnly: WorktreeListEntry[];
  /** Paths the host knows about but git doesn't. */
  knownOnly: string[];
}

const BASE_REF_FALLBACKS = ["main", "master"] as const;

/**
 * Pure git+filesystem operations for per-session worktrees. The
 * orchestrator (Phase 11+) is responsible for DB-backed bookkeeping;
 * this manager only knows how to create, remove, list, and reconcile.
 */
export class WorktreeManager {
  /** Branch name agent-dock uses for every session worktree. */
  static branchName(taskId: string, sessionId: string): string {
    return `agent-dock/${taskId}/${sessionId}`;
  }

  /** Worktree directory: `<workspaceDir>/worktrees/<projectId>/<sessionId>/` */
  static worktreePath(workspaceDir: string, projectId: string, sessionId: string): string {
    return resolve(workspaceDir, "worktrees", projectId, sessionId);
  }

  async resolveBaseRef(projectRoot: string, requested?: string): Promise<string> {
    if (requested) {
      if (!(await refExists(projectRoot, requested))) {
        throw new Error(`Base ref "${requested}" does not exist in ${projectRoot}`);
      }
      return requested;
    }
    for (const candidate of BASE_REF_FALLBACKS) {
      if (await refExists(projectRoot, candidate)) return candidate;
    }
    throw new Error(
      `No base ref found in ${projectRoot}; tried ${BASE_REF_FALLBACKS.join(", ")}`,
    );
  }

  async create(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
    const branch = WorktreeManager.branchName(input.taskId, input.sessionId);
    const worktreePath = WorktreeManager.worktreePath(
      input.workspaceDir,
      input.projectId,
      input.sessionId,
    );
    const baseRef = await this.resolveBaseRef(input.projectRoot, input.baseRef);

    if (existsSync(worktreePath)) {
      throw new Error(`Worktree path already exists: ${worktreePath}`);
    }
    if (await branchExists(input.projectRoot, branch)) {
      throw new Error(`Branch already exists: ${branch}`);
    }

    await mkdir(dirname(worktreePath), { recursive: true });
    await gitOrThrow(input.projectRoot, [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      baseRef,
    ]);

    // Git canonicalizes paths internally (e.g. /var → /private/var on
    // macOS). Return the canonical form so downstream comparisons
    // against `git worktree list` match exactly.
    return { worktreePath: realpathSync(worktreePath), branch, baseRef };
  }

  /** Remove the worktree dir and delete the branch. Best-effort; never throws on missing pieces. */
  async remove(input: RemoveWorktreeInput): Promise<void> {
    // `git worktree remove` may fail if the dir is missing or dirty;
    // --force handles the dirty case. If the path is already gone we
    // still try `prune` so git's metadata stays consistent.
    if (existsSync(input.worktreePath)) {
      await runGit(input.projectRoot, [
        "worktree",
        "remove",
        "--force",
        input.worktreePath,
      ]);
    }
    await runGit(input.projectRoot, ["worktree", "prune"]);
    if (await branchExists(input.projectRoot, input.branch)) {
      await runGit(input.projectRoot, ["branch", "-D", input.branch]);
    }
  }

  list(projectRoot: string): Promise<WorktreeListEntry[]> {
    return worktreeList(projectRoot);
  }

  /** Cross-check filesystem state with the host's known set. */
  async findOrphans(input: ListOrphansInput): Promise<OrphanReport> {
    const known = new Set(input.knownPaths.map(canonical));
    const live = await worktreeList(input.projectRoot);
    // The first entry from `worktree list` is always the main repo.
    const mainPath = canonical(input.projectRoot);
    const liveSession = live.filter((w) => canonical(w.path) !== mainPath);

    const onDiskOnly = liveSession.filter((w) => !known.has(canonical(w.path)));
    const knownOnly = input.knownPaths.filter(
      (p) => !liveSession.some((w) => canonical(w.path) === canonical(p)),
    );
    return { onDiskOnly, knownOnly };
  }
}

/**
 * Resolve a path to its canonical form when it exists on disk; fall
 * back to `path.resolve` so missing-path comparisons still work.
 */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

// Re-export utility helpers for downstream consumers (orchestrator, tests).
export { worktreeList, refExists, branchExists } from "./git.js";
export { join as joinPath };
