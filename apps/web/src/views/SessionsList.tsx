import * as React from "react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SessionStatusFilter,
  type SessionStatusFilterValue,
} from "@/components/sessions/SessionStatusFilter";
import { SessionRow } from "@/components/sessions/SessionRow";
import { listSessions, type SessionListItem } from "@/lib/api";
import type { Navigate } from "@/lib/router";

const PAGE_SIZE = 50;
const POLL_MS = 5000;

interface SessionsListProps {
  navigate: Navigate;
}

export function SessionsList({ navigate }: SessionsListProps) {
  const [filter, setFilter] = React.useState<SessionStatusFilterValue>("all");
  const [items, setItems] = React.useState<SessionListItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessions({
      status: filter === "all" ? undefined : filter,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, tick]);

  const hasLive = items.some(
    (i) => i.status === "running" || i.status === "paused" || i.status === "awaiting_approval",
  );
  React.useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [hasLive]);

  return (
    <>
      <TopBar
        title="Sessions"
        sub={`${total} total${filter === "all" ? "" : ` · ${filter.replace("_", " ")}`}`}
        right={
          <Button variant="outline" size="sm" onClick={() => setTick((n) => n + 1)}>
            Refresh
          </Button>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-3 p-5">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <SessionStatusFilter value={filter} onChange={setFilter} />

          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,12rem)_minmax(0,8rem)_minmax(0,9rem)_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground">
              <span>Status</span>
              <span>Task</span>
              <span>Project</span>
              <span>Step</span>
              <span>Created</span>
              <span></span>
            </div>
            {loading && items.length === 0 ? (
              <div className="space-y-1 p-3">
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No sessions {filter === "all" ? "yet" : `with status ${filter}`}.
              </div>
            ) : (
              items.map((i) => <SessionRow key={i.sessionId} item={i} navigate={navigate} />)
            )}
          </div>

          {total > items.length && (
            <p className="text-center text-xs text-muted-foreground">
              Showing {items.length} of {total}. Pagination coming with the next sessions UX
              tweak.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
