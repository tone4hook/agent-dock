/**
 * PostToolUse hook builder — extension point.
 *
 * Phase 12 design (recap): Claude's SDK already surfaces `tool_use`
 * events through `runStreamed`, and the orchestrator captures them
 * in step_events (Phase 11). The PlanWatcher (this package's
 * planWatcher.ts) catches relevant file edits regardless of source,
 * agent or human. So for v1 the hook is redundant.
 *
 * This module ships as a no-op so future phases (or downstream
 * forks) can drop in a Claude `--agents` JSON snippet that emits
 * a sentinel on tool use without rewriting the integration surface.
 *
 * Returning `null` here tells the orchestrator "no hook configured";
 * any non-null return value is passed through to the SDK as the
 * agents-config entry. Schema is intentionally `unknown` so future
 * variants don't break this file.
 */

export interface PostToolUseHookContext {
  worktreePath: string;
  watchedPaths: string[];
}

export type PostToolUseHookBuilder = (
  ctx: PostToolUseHookContext,
) => unknown | null;

export const noopPostToolUseHook: PostToolUseHookBuilder = () => null;
