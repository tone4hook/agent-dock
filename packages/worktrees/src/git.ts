import { spawn } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly result: GitResult,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
  });
}

export async function gitOrThrow(cwd: string, args: string[]): Promise<GitResult> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) {
    throw new GitError(
      `git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      result,
    );
  }
  return result;
}

/** Returns true if `<ref>` resolves locally — main, master, full SHA, etc. */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--verify", "--quiet", ref]);
  return result.exitCode === 0;
}

/** Returns true if `<branch>` is a local branch. */
export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(cwd, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return result.exitCode === 0;
}

export interface WorktreeListEntry {
  path: string;
  head: string;
  branch: string | null; // null for detached
}

/** Parses `git worktree list --porcelain` into structured rows. */
export async function worktreeList(cwd: string): Promise<WorktreeListEntry[]> {
  const result = await gitOrThrow(cwd, ["worktree", "list", "--porcelain"]);
  const out: WorktreeListEntry[] = [];
  let current: Partial<WorktreeListEntry> = {};
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        out.push({
          path: current.path,
          head: current.head ?? "",
          branch: current.branch ?? null,
        });
      }
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length).trim();
    } else if (line.trim() === "" && current.path) {
      out.push({
        path: current.path,
        head: current.head ?? "",
        branch: current.branch ?? null,
      });
      current = {};
    }
  }
  if (current.path) {
    out.push({
      path: current.path,
      head: current.head ?? "",
      branch: current.branch ?? null,
    });
  }
  return out;
}
