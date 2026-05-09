import * as React from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IssueRow } from "@/components/jira/IssueRow";
import { listMyJiraIssues } from "@/lib/api";
import type { Navigate } from "@/lib/router";
import { jiraCache, useJiraCache } from "@/views/jira/cache";

interface Props {
  savedKeys: Set<string>;
  navigate: Navigate;
}

export function MineTab({ savedKeys, navigate }: Props) {
  const cached = useJiraCache().mine;
  const [loading, setLoading] = React.useState(cached == null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (cached != null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyJiraIssues({})
      .then((r) => {
        if (cancelled) return;
        jiraCache.setMine({
          issues: r.issues,
          nextPageToken: r.nextPageToken,
          isLast: r.isLast,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cached]);

  async function loadMore() {
    if (!cached || !cached.nextPageToken) return;
    setBusy(true);
    try {
      const r = await listMyJiraIssues({ nextPageToken: cached.nextPageToken });
      jiraCache.setMine({
        issues: [...cached.issues, ...r.issues],
        nextPageToken: r.nextPageToken,
        isLast: r.isLast,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const issues = cached?.issues ?? [];
  const isLast = cached?.isLast ?? true;
  const nextPageToken = cached?.nextPageToken ?? null;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
          Assigned to me
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {issues.length}
            {isLast ? "" : "+"}
          </span>
        </div>
        {issues.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing on your plate. Nice.
          </div>
        ) : (
          issues.map((i) => (
            <IssueRow key={i.key} issue={i} saved={savedKeys.has(i.key)} navigate={navigate} />
          ))
        )}
      </div>
      {!isLast && nextPageToken && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
