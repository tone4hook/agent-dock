import React from "react";
import type { Session } from "@agent-dock/shared";
import { Badge } from "@/components/ui/badge";
import { listTaskSessions } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  taskId: string;
  navigate: Navigate;
}

const NON_TERMINAL = new Set(["running", "awaiting_approval", "paused"]);

export function TaskSessionsList({ taskId, navigate }: Props) {
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setSessions(await listTaskSessions(taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // 5s poll while any non-terminal session is in the list, so the
  // status pill keeps up without a manual reload.
  React.useEffect(() => {
    if (!sessions) return;
    if (!sessions.some((s) => NON_TERMINAL.has(s.status))) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [sessions, refresh]);

  if (sessions === null) {
    return (
      <p className="text-sm text-muted-foreground">{error ?? "Loading sessions…"}</p>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sessions yet. Start one from the header above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {sessions.map((s) => (
        <button
          key={s.id}
          className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left hover:border-primary"
          onClick={() => navigate({ view: "session-detail", sessionId: s.id })}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge>{s.status}</Badge>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {s.branch}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              created {new Date(s.createdAt).toLocaleString()}
              {s.endedAt ? ` · ended ${new Date(s.endedAt).toLocaleString()}` : ""}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
