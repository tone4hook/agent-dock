import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IssueRow } from "@/components/jira/IssueRow";
import { SprintHeader } from "@/components/jira/SprintHeader";
import { getJiraSprint, type JiraSprintIssue, type JiraSprintSummary } from "@/lib/api";
import type { Navigate } from "@/lib/router";
import { jiraCache, useJiraCache } from "@/views/jira/cache";

const FILTER_ALL = "__all__";
const FILTER_UNASSIGNED = "__unassigned__";

interface Props {
  savedKeys: Set<string>;
  navigate: Navigate;
}

export function SprintTab({ savedKeys, navigate }: Props) {
  const cached = useJiraCache().sprint;
  const [loading, setLoading] = React.useState(cached == null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (cached != null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJiraSprint()
      .then((r) => {
        if (cancelled) return;
        jiraCache.setSprint({ sprint: r.sprint, issues: r.issues });
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

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-10" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
        <p className="mt-1 text-xs text-muted-foreground">
          Make sure a Jira board id is set in Settings; Sprint requires it.
        </p>
      </div>
    );
  }

  const sprint = cached?.sprint ?? null;
  const allIssues = cached?.issues ?? [];

  if (!sprint) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No active sprint on this board.
      </div>
    );
  }

  return (
    <SprintBoard
      sprint={sprint}
      allIssues={allIssues}
      savedKeys={savedKeys}
      navigate={navigate}
      filterDisabled={loading}
    />
  );
}

interface SprintBoardProps {
  sprint: JiraSprintSummary;
  allIssues: JiraSprintIssue[];
  savedKeys: Set<string>;
  navigate: Navigate;
  filterDisabled: boolean;
}

function SprintBoard({
  sprint,
  allIssues,
  savedKeys,
  navigate,
  filterDisabled,
}: SprintBoardProps) {
  const [assignee, setAssignee] = React.useState<string>(FILTER_ALL);

  const assignees = React.useMemo(() => {
    const named = new Set<string>();
    let hasUnassigned = false;
    for (const i of allIssues) {
      if (i.assignee) named.add(i.assignee);
      else hasUnassigned = true;
    }
    return {
      named: Array.from(named).sort((a, b) => a.localeCompare(b)),
      hasUnassigned,
    };
  }, [allIssues]);

  // If the currently-selected assignee disappears (e.g. after a refresh),
  // fall back to "All".
  React.useEffect(() => {
    if (assignee === FILTER_ALL) return;
    if (assignee === FILTER_UNASSIGNED && assignees.hasUnassigned) return;
    if (assignees.named.includes(assignee)) return;
    setAssignee(FILTER_ALL);
  }, [assignee, assignees]);

  const issues = React.useMemo(() => {
    if (assignee === FILTER_ALL) return allIssues;
    if (assignee === FILTER_UNASSIGNED) return allIssues.filter((i) => !i.assignee);
    return allIssues.filter((i) => i.assignee === assignee);
  }, [allIssues, assignee]);

  const counts = {
    todo: issues.filter((i) => i.statusCategory === "todo").length,
    indeterminate: issues.filter((i) => i.statusCategory === "indeterminate").length,
    done: issues.filter((i) => i.statusCategory === "done").length,
    other: issues.filter((i) => i.statusCategory === null).length,
  };

  return (
    <div className="space-y-4">
      <SprintHeader sprint={sprint} issues={allIssues} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CountTile label="To do" value={counts.todo} />
        <CountTile label="In progress" value={counts.indeterminate} tone="primary" />
        <CountTile label="Done" value={counts.done} tone="success" />
        <CountTile label="Other" value={counts.other} />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">
            Sprint board
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {issues.length}
              {issues.length !== allIssues.length ? ` of ${allIssues.length}` : ""} issues
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Assignee</span>
            <Select value={assignee} onValueChange={setAssignee} disabled={filterDisabled}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All</SelectItem>
                {assignees.hasUnassigned && (
                  <SelectItem value={FILTER_UNASSIGNED}>Unassigned</SelectItem>
                )}
                {assignees.named.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {issues.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {allIssues.length === 0
              ? "Sprint has no issues yet."
              : "No issues match the current filter."}
          </div>
        ) : (
          issues.map((i) => (
            <IssueRow key={i.key} issue={i} saved={savedKeys.has(i.key)} navigate={navigate} />
          ))
        )}
      </div>
    </div>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "primary" | "success";
}) {
  const cls =
    tone === "success"
      ? "border-success/40 bg-success/10"
      : tone === "primary"
        ? "border-primary/40 bg-primary/10"
        : "border-border bg-card";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
