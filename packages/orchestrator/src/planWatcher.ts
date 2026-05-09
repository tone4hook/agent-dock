import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

export type PlanWatcherEventKind =
  | "plan_updated"
  | "findings_updated"
  | "handoff_updated";

export interface PlanWatcherEvent {
  kind: PlanWatcherEventKind;
  /** Path relative to the worktree root, e.g. ".plan/task_plan.md". */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  /** Truncated body for previews. */
  preview: string;
  /** Parsed structure for handoff JSON; undefined for markdown files. */
  parsed?: unknown;
}

export interface PlanWatcherOptions {
  worktreePath: string;
  onEvent: (event: PlanWatcherEvent) => void;
  /**
   * Poll interval in milliseconds. Defaults to 200ms, which keeps the
   * "edit → event" lag under 500ms without native FS watchers.
   */
  stabilityMs?: number;
}

const PREVIEW_BYTES = 4096;

/**
 * Polls `<worktreePath>/.plan/*` and `<worktreePath>/.handoff/*` and
 * surfaces a structured event whenever a relevant file is added or
 * changed. Read-only — only filesystem; never writes.
 *
 * Lifecycle:
 *   const w = new PlanWatcher({ worktreePath, onEvent });
 *   await w.start();   // performs an initial scan and starts polling
 *   await w.stop();    // cancels polling
 */
export class PlanWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private canonicalRoot = "";
  private readonly seen = new Map<string, string>();

  constructor(private readonly opts: PlanWatcherOptions) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.canonicalRoot = canonical(this.opts.worktreePath);
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.stabilityMs ?? 200);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    if (this.stopped) return;
    const current = new Set<string>();
    for (const absPath of listCandidateFiles(this.canonicalRoot)) {
      current.add(absPath);
      const signature = fileSignature(absPath);
      if (!signature) continue;
      if (this.seen.get(absPath) === signature) continue;
      this.seen.set(absPath, signature);
      this.handleChange(absPath);
    }
    for (const absPath of [...this.seen.keys()]) {
      if (!current.has(absPath)) this.seen.delete(absPath);
    }
  }

  private handleChange(absPath: string): void {
    if (this.stopped) return;
    const rel = relative(this.canonicalRoot, absPath);
    if (!rel || rel.startsWith("..")) return;

    const kind = classify(rel);
    if (!kind) return;

    let body = "";
    if (existsSync(absPath)) {
      try {
        body = readFileSync(absPath, "utf8");
      } catch {
        body = "";
      }
    }

    const event: PlanWatcherEvent = {
      kind,
      relPath: rel,
      absPath,
      preview: body.length > PREVIEW_BYTES ? `${body.slice(0, PREVIEW_BYTES)}…` : body,
    };

    if (kind === "handoff_updated" && body.trim().length > 0) {
      try {
        event.parsed = JSON.parse(body);
      } catch {
        // Leave parsed undefined; consumers can show preview text.
      }
    }

    this.opts.onEvent(event);
  }
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function listCandidateFiles(root: string): string[] {
  const out: string[] = [];
  collect(join(root, ".plan"), out, 4);
  collect(join(root, ".handoff"), out, 4);
  return out;
}

function collect(dir: string, out: string[], depth: number): void {
  if (depth < 0 || !existsSync(dir)) return;
  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(abs, out, depth - 1);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

function fileSignature(absPath: string): string | null {
  try {
    const stat = statSync(absPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function classify(relPath: string): PlanWatcherEventKind | null {
  const norm = relPath.replace(/\\/g, "/");
  if (norm === ".plan/task_plan.md") return "plan_updated";
  if (norm === ".plan/findings.md") return "findings_updated";
  if (norm.startsWith(".handoff/") && norm.endsWith(".json")) return "handoff_updated";
  // Other files inside .plan/ are also surfaced as plan_updated for completeness.
  if (norm.startsWith(".plan/") && norm.endsWith(".md")) return "plan_updated";
  return null;
}
