export type OrchestratorEventKind =
  | "session_status"
  | "step_status"
  | "agent"
  | "stderr"
  | "artifact"
  | "plan_updated"
  | "findings_updated"
  | "handoff_updated";

export interface OrchestratorEvent {
  /** Monotonic id, unique per process run. */
  id: number;
  sessionId: string;
  stepId: string | null;
  kind: OrchestratorEventKind;
  payload: unknown;
  createdAt: string;
}

export type OrchestratorListener = (event: OrchestratorEvent) => void;

/**
 * In-process pub/sub keyed by sessionId. Persisted history lives in
 * `step_events` (DB); this bus is for live streaming to SSE clients.
 */
export class EventBus {
  private nextId = 1;
  private readonly listeners = new Map<string, Set<OrchestratorListener>>();

  publish(
    sessionId: string,
    kind: OrchestratorEventKind,
    payload: unknown,
    stepId: string | null = null,
  ): OrchestratorEvent {
    const event: OrchestratorEvent = {
      id: this.nextId++,
      sessionId,
      stepId,
      kind,
      payload,
      createdAt: new Date().toISOString(),
    };
    for (const fn of this.listeners.get(sessionId) ?? []) {
      fn(event);
    }
    return event;
  }

  subscribe(sessionId: string, listener: OrchestratorListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<OrchestratorListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  /** Drop all listeners for a session (called on session terminal status). */
  closeSession(sessionId: string): void {
    this.listeners.delete(sessionId);
  }
}
