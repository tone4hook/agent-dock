import { randomUUID } from "node:crypto";
import { haikuExplore } from "@agent-dock/agents";
import { truncate } from "@agent-dock/atlassian";
import { ATLASSIAN_ITEM_BYTE_BUDGET } from "@agent-dock/workflows";
import type { AtlassianCacheRepo } from "@agent-dock/db";
import type { MetaContextScope } from "@agent-dock/shared";

export interface ExplorationStartInput {
  prompt: string;
  workingDirectory: string;
  scopeType: MetaContextScope;
  scopeId: string;
}

export interface ExplorationEvent {
  id: number; // monotonic per exploration
  kind: "agent" | "stderr" | "status" | "reference";
  payload: unknown;
  createdAt: string;
}

interface ExplorationState {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  scopeType: MetaContextScope;
  scopeId: string;
  prompt: string;
  workingDirectory: string;
  markdown: string;
  errorMessage: string | null;
  events: ExplorationEvent[];
  abort: AbortController;
}

export type ExplorationListener = (event: ExplorationEvent) => void;

export interface ExplorationSnapshot {
  id: string;
  status: ExplorationState["status"];
  scopeType: MetaContextScope;
  scopeId: string;
  prompt: string;
  workingDirectory: string;
  markdown: string;
  errorMessage: string | null;
}

/**
 * Runner abstraction so tests can inject a stub instead of invoking the
 * real Claude Haiku SDK. Production wires this to `haikuExplore` from
 * @agent-dock/agents.
 */
export interface HaikuRunnerInput {
  prompt: string;
  workingDirectory: string;
  signal?: AbortSignal;
  onEvent?: (event: { kind: "agent" | "stderr"; payload: unknown }) => void;
}

export interface HaikuRunnerResult {
  status: "completed" | "failed" | "cancelled";
  markdown: string;
  errorMessage?: string;
}

export type HaikuRunner = (input: HaikuRunnerInput) => Promise<HaikuRunnerResult>;

export interface ExplorationCoordinatorDeps {
  atlassianCache: AtlassianCacheRepo;
  /** Optional runner override — defaults to the real haikuExplore. */
  runner?: HaikuRunner;
}

/**
 * In-memory coordinator for ad-hoc Haiku exploration runs. State lives
 * only for the lifetime of the API process — nothing is persisted
 * until the user explicitly saves the markdown as a meta-context.
 */
export class ExplorationCoordinator {
  private readonly explorations = new Map<string, ExplorationState>();
  private readonly listeners = new Map<string, Set<ExplorationListener>>();
  private nextEventId = 1;
  private readonly atlassianCache: AtlassianCacheRepo;
  private readonly runner: HaikuRunner;

  constructor(deps: ExplorationCoordinatorDeps) {
    this.atlassianCache = deps.atlassianCache;
    this.runner = deps.runner ?? haikuExplore;
  }

  start(input: ExplorationStartInput): ExplorationSnapshot {
    const id = randomUUID();
    const abort = new AbortController();
    const state: ExplorationState = {
      id,
      status: "running",
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      markdown: "",
      errorMessage: null,
      events: [],
      abort,
    };
    this.explorations.set(id, state);
    this.emit(state, "status", { status: "running" });

    // Augment the prompt with linked Atlassian content (if cached) so
    // Haiku sees the ticket / page body without the user having to
    // paste it in. Augmented prompt goes to the runner; the user-facing
    // snapshot keeps the original.
    const reference = buildHaikuReference(input.scopeType, input.scopeId, {
      atlassianCache: this.atlassianCache,
    });
    if (reference) {
      this.emit(state, "reference", {
        status: "applied",
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });
    } else if (input.scopeType === "jira" || input.scopeType === "confluence") {
      // Only worth surfacing for scopes where reference augmentation
      // applies — task/project scopes don't (yet) build a reference,
      // so a missing event there would be noise.
      this.emit(state, "reference", {
        status: "missing",
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });
    }
    const augmentedPrompt = reference
      ? `${reference.markdown}\n\n---\n\n# Your task\n\n${input.prompt}`
      : input.prompt;

    void this.run(state, augmentedPrompt).catch((err) => {
      state.status = "failed";
      state.errorMessage = err instanceof Error ? err.message : String(err);
      this.emit(state, "status", { status: "failed", error: state.errorMessage });
    });

    return this.snapshot(state);
  }

  cancel(id: string): ExplorationSnapshot | null {
    const state = this.explorations.get(id);
    if (!state) return null;
    if (state.status === "running") state.abort.abort();
    return this.snapshot(state);
  }

  get(id: string): ExplorationSnapshot | null {
    const state = this.explorations.get(id);
    return state ? this.snapshot(state) : null;
  }

  /** Replay events buffered before subscription, then attach listener. */
  subscribe(
    id: string,
    listener: ExplorationListener,
  ): { unsubscribe: () => void; replay: ExplorationEvent[] } | null {
    const state = this.explorations.get(id);
    if (!state) return null;
    const listeners = this.listeners.get(id) ?? new Set<ExplorationListener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return {
      replay: [...state.events],
      unsubscribe: () => {
        listeners.delete(listener);
        if (listeners.size === 0) this.listeners.delete(id);
      },
    };
  }

  /** Drop in-memory state. Called once the user saves or dismisses. */
  forget(id: string): void {
    this.explorations.delete(id);
    this.listeners.delete(id);
  }

  async shutdown(): Promise<void> {
    for (const state of this.explorations.values()) {
      if (state.status === "running") state.abort.abort();
    }
    // Listeners drop on next tick; nothing to await — the exploration
    // promises self-resolve via the `run` finally block.
  }

  private async run(state: ExplorationState, prompt: string): Promise<void> {
    const result = await this.runner({
      prompt,
      workingDirectory: state.workingDirectory,
      signal: state.abort.signal,
      onEvent: (e) => this.emit(state, e.kind, e.payload),
    });
    state.markdown = result.markdown;
    state.errorMessage = result.errorMessage ?? null;
    state.status = result.status;
    this.emit(state, "status", {
      status: result.status,
      markdown: result.markdown,
      error: state.errorMessage,
    });
  }

  private emit(state: ExplorationState, kind: ExplorationEvent["kind"], payload: unknown): void {
    const event: ExplorationEvent = {
      id: this.nextEventId++,
      kind,
      payload,
      createdAt: new Date().toISOString(),
    };
    state.events.push(event);
    for (const listener of this.listeners.get(state.id) ?? []) {
      listener(event);
    }
  }

  private snapshot(state: ExplorationState): ExplorationSnapshot {
    return {
      id: state.id,
      status: state.status,
      scopeType: state.scopeType,
      scopeId: state.scopeId,
      prompt: state.prompt,
      workingDirectory: state.workingDirectory,
      markdown: state.markdown,
      errorMessage: state.errorMessage,
    };
  }
}

/**
 * Build a markdown reference block for the given Atlassian scope by
 * pulling the cached payload out of `AtlassianCacheRepo`. Returns null
 * when the cache has nothing for the scope, when the payload is
 * malformed, or for scope types that don't (yet) build a reference
 * (`task`, `project`).
 *
 * The format mirrors the planner's ContextPack rendering so users see
 * the same shape across surfaces. Truncated to ATLASSIAN_ITEM_BYTE_BUDGET
 * (6KB) per item to keep the augmented prompt bounded.
 */
export function buildHaikuReference(
  scopeType: MetaContextScope,
  scopeId: string,
  deps: { atlassianCache: AtlassianCacheRepo },
): { markdown: string } | null {
  if (scopeType === "jira") {
    const cached = deps.atlassianCache.getJiraIssue(scopeId);
    if (!cached) return null;
    const detail = parseDetail<{ summary?: string; status?: string; descriptionMd?: string }>(
      cached.payloadJson,
    );
    if (!detail) return null;
    const lines: string[] = [
      "# Reference context",
      "",
      `## ${scopeId}${detail.summary ? ` — ${detail.summary}` : ""}`,
      "",
    ];
    if (detail.status) lines.push(`- Status: ${detail.status}`);
    if (detail.descriptionMd && detail.descriptionMd.trim()) {
      lines.push("");
      lines.push("### Description");
      lines.push("");
      lines.push(truncate(detail.descriptionMd, ATLASSIAN_ITEM_BYTE_BUDGET));
    }
    return { markdown: lines.join("\n").trimEnd() };
  }

  if (scopeType === "confluence") {
    const cached = deps.atlassianCache.getConfluencePage(scopeId);
    if (!cached) return null;
    const detail = parseDetail<{ title?: string; bodyMd?: string }>(cached.payloadJson);
    if (!detail) return null;
    const lines: string[] = [
      "# Reference context",
      "",
      `## ${detail.title ?? scopeId}`,
      "",
      `- Page id: ${scopeId}`,
    ];
    if (detail.bodyMd && detail.bodyMd.trim()) {
      lines.push("");
      lines.push("### Body");
      lines.push("");
      lines.push(truncate(detail.bodyMd, ATLASSIAN_ITEM_BYTE_BUDGET));
    }
    return { markdown: lines.join("\n").trimEnd() };
  }

  // task / project scopes: deferred (would aggregate every linked
  // jira+confluence; defer until user feedback says it's needed).
  return null;
}

function parseDetail<T>(payloadJson: string): T | null {
  try {
    const parsed = JSON.parse(payloadJson) as { detail?: T };
    return parsed?.detail ?? null;
  } catch {
    return null;
  }
}
