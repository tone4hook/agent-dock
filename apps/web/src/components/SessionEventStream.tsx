import React from "react";
import type { PipelineStep } from "@agent-dock/shared";
import { Badge } from "@/components/ui/badge";
import { sessionEventStreamUrl } from "@/lib/api";

interface SessionEvent {
  stepId: string | null;
  payload: unknown;
  createdAt: string;
  /** watcher/agent/stderr/etc — set from the SSE event name. */
  kind: string;
}

interface Props {
  sessionId: string;
  steps: PipelineStep[];
  onTick?: () => void;
}

const MAX_EVENTS = 200;

export function SessionEventStream({ sessionId, steps, onTick }: Props) {
  const [events, setEvents] = React.useState<SessionEvent[]>([]);

  React.useEffect(() => {
    setEvents([]);
    const source = new EventSource(sessionEventStreamUrl(sessionId));
    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { stepId: string | null; payload: unknown; createdAt: string };
        const ev: SessionEvent = { ...data, kind: e.type };
        setEvents((cur) => [...cur.slice(-(MAX_EVENTS - 1)), ev]);
        if (e.type === "session_status" || e.type === "step_status") onTick?.();
      } catch {
        // ignore malformed
      }
    };
    for (const t of [
      "session_status",
      "step_status",
      "agent",
      "stderr",
      "artifact",
      "plan_updated",
      "findings_updated",
      "handoff_updated",
      "rejection",
    ]) {
      source.addEventListener(t, handle);
    }
    return () => source.close();
  }, [sessionId]);

  // Group events by stepId for the timeline view.
  const grouped = new Map<string, SessionEvent[]>();
  const sessionLevel: SessionEvent[] = [];
  for (const ev of events) {
    if (!ev.stepId) {
      sessionLevel.push(ev);
      continue;
    }
    const arr = grouped.get(ev.stepId) ?? [];
    arr.push(ev);
    grouped.set(ev.stepId, arr);
  }

  return (
    <div className="space-y-3">
      {sessionLevel.length > 0 ? (
        <div className="rounded-md border border-border bg-background p-3">
          <div className="text-xs uppercase text-muted-foreground">Session events</div>
          <ul className="mt-2 space-y-1 text-xs">
            {sessionLevel.slice(-8).map((ev, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge>{ev.kind}</Badge>
                <span className="font-mono text-muted-foreground">
                  {new Date(ev.createdAt).toLocaleTimeString()}
                </span>
                <span className="truncate">{summarize(ev.payload)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {steps.map((step) => {
        const stepEvents = grouped.get(step.id) ?? [];
        return (
          <div key={step.id} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">
                  {step.ord}. {step.role}
                </span>
                <Badge>{step.status}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {stepEvents.length} events
              </span>
            </div>
            {stepEvents.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs">
                {stepEvents.slice(-8).map((ev, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge>{ev.kind}</Badge>
                    <span className="truncate">{summarize(ev.payload)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  const obj = payload as Record<string, unknown>;
  if (typeof obj.status === "string") {
    // Phase 34: when the event payload carries an `error` string, surface
    // it inline instead of just `status: failed`. Makes the raw event
    // stream self-documenting on failure.
    if (typeof obj.error === "string" && obj.error.length > 0) {
      return `status: ${obj.status} — ${obj.error.slice(0, 200)}`;
    }
    return `status: ${obj.status}`;
  }
  if (typeof obj.line === "string") return obj.line.slice(0, 120);
  if (typeof obj.kind === "string") return `${obj.kind}${obj.path ? ` ${obj.path}` : ""}`;
  if (obj.payload && typeof (obj.payload as { type?: string }).type === "string") {
    const t = (obj.payload as { type: string; name?: string }).type;
    const n = (obj.payload as { name?: string }).name;
    return n ? `${t} ${n}` : t;
  }
  if (typeof obj.type === "string") {
    const n = typeof obj.name === "string" ? ` ${obj.name}` : "";
    return `${obj.type}${n}`;
  }
  return JSON.stringify(payload).slice(0, 120);
}
