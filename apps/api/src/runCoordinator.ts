import type { ArtifactStore } from "@agent-dock/artifacts";
import type { SdkAgentRunner } from "@agent-dock/agents";
import type {
  AgentRunEventsRepo,
  AgentRunsRepo,
  ArtifactsRepo,
  SettingsRepo,
} from "@agent-dock/db";
import type {
  AgentRunEventRecord,
  AgentRunRecord,
  CreateAgentRunInput,
} from "@agent-dock/shared";
import { recordRunArtifacts } from "./artifactRecorder.js";

interface RunCoordinatorDeps {
  repos: {
    settings: SettingsRepo;
    runs: AgentRunsRepo;
    events: AgentRunEventsRepo;
    artifacts: ArtifactsRepo;
  };
  artifactStore: ArtifactStore;
  runner: SdkAgentRunner;
}

export type RunEventListener = (event: AgentRunEventRecord) => void;

export class RunCoordinator {
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  constructor(private readonly deps: RunCoordinatorDeps) {}

  create(input: CreateAgentRunInput): AgentRunRecord {
    const settings = this.deps.repos.settings.getRuntime();
    const run = this.deps.repos.runs.create({
      provider: input.provider ?? settings.defaultProvider,
      modelHint: input.modelHint ?? settings.defaultModelHint,
      reasoningHint: input.reasoningHint ?? settings.defaultReasoningHint,
      permissionMode: input.permissionMode ?? settings.defaultPermissionMode,
      workingDirectory: input.workingDirectory ?? settings.defaultWorkingDirectory,
      prompt: input.prompt,
    });

    const controller = new AbortController();
    const entry = { controller, promise: Promise.resolve() };
    this.active.set(run.id, entry);

    entry.promise = this.execute(run.id, controller).catch((err) => {
      this.deps.repos.runs.updateStatus(run.id, "failed", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });

    return run;
  }

  private async execute(runId: string, controller: AbortController): Promise<void> {
    const run = this.must(this.deps.repos.runs.get(runId));
    this.deps.repos.runs.updateStatus(runId, "running");
    this.emit(runId, "status", { status: "running" }, run.provider);

    try {
      const result = await this.deps.runner.run({
        provider: run.provider,
        prompt: run.prompt,
        workingDirectory: run.workingDirectory,
        modelHint: run.modelHint,
        reasoningHint: run.reasoningHint,
        permissionMode: run.permissionMode,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "stderr") {
            this.emit(runId, "stderr", { line: event.line }, event.provider);
          } else {
            this.emit(runId, "agent", event.event, event.provider);
          }
        },
      });

      const finalText = result.stdout || result.stderr;
      await recordRunArtifacts({
        artifactStore: this.deps.artifactStore,
        artifactsRepo: this.deps.repos.artifacts,
        runId,
        finalText,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      this.deps.repos.runs.updateStatus(runId, result.status, {
        finalText,
        errorMessage: result.errorMessage ?? null,
      });
      this.emit(runId, "status", { status: result.status }, run.provider);
    } finally {
      this.active.delete(runId);
    }
  }

  async cancel(runId: string): Promise<AgentRunRecord> {
    const active = this.active.get(runId);
    active?.controller.abort();
    if (active) {
      await Promise.race([
        active.promise.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    }
    const run = this.deps.repos.runs.updateStatus(runId, "cancelled");
    this.emit(runId, "status", { status: "cancelled" }, run.provider);
    return run;
  }

  async shutdown(reason = "shutdown", timeoutMs = 8000): Promise<void> {
    const active = [...this.active.entries()];
    for (const [runId, entry] of active) {
      entry.controller.abort();
      const run = this.deps.repos.runs.get(runId);
      if (run) {
        this.deps.repos.runs.updateStatus(runId, "cancelled", { errorMessage: reason });
        this.emit(runId, "shutdown", { reason }, run.provider);
      }
    }
    this.notifyShutdown(reason);
    await Promise.race([
      Promise.allSettled(active.map(([, entry]) => entry.promise)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<RunEventListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  private emit(
    runId: string,
    eventType: string,
    payload: unknown,
    provider: AgentRunRecord["provider"] | null,
  ): void {
    const event = this.deps.repos.events.create({ runId, eventType, provider, payload });
    for (const listener of this.listeners.get(runId) ?? []) {
      listener(event);
    }
  }

  private notifyShutdown(reason: string): void {
    for (const [runId, listeners] of this.listeners) {
      const run = this.deps.repos.runs.get(runId);
      const event = this.deps.repos.events.create({
        runId,
        eventType: "shutdown",
        provider: run?.provider ?? null,
        payload: { reason },
      });
      for (const listener of listeners) listener(event);
    }
  }

  private must<T>(value: T | null | undefined): T {
    if (!value) throw new Error("Run not found");
    return value;
  }
}
