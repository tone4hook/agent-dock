import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskWithCounts } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface TaskCardProps {
  task: TaskWithCounts;
  navigate: Navigate;
}

export function TaskCard({ task, navigate }: TaskCardProps) {
  const live = task.liveSession;
  const stepLabel = live?.currentStepRole ? prettyRole(live.currentStepRole) : null;
  const stepTone = live?.status === "awaiting_approval"
    ? "warn"
    : live?.status === "paused"
      ? "muted"
      : live
        ? "primary"
        : null;

  return (
    <button
      type="button"
      onClick={() => navigate({ view: "task-detail", taskId: task.id })}
      className="w-full rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="line-clamp-2 text-sm font-medium">{task.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.jiraLinksCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            {task.jiraLinksCount} jira
          </span>
        )}
        {live && stepTone && (
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
              stepTone === "warn" && "border-warn/40 bg-warn/10 text-warn",
              stepTone === "muted" && "border-border bg-muted text-muted-foreground",
              stepTone === "primary" && "border-primary/40 bg-primary/10 text-primary",
            )}
          >
            {live.status === "awaiting_approval" ? "● " : live.status === "paused" ? "⏸ " : "▶ "}
            {stepLabel ?? live.status}
          </span>
        )}
      </div>
    </button>
  );
}

function prettyRole(role: string): string {
  switch (role) {
    case "code_review":
      return "review";
    default:
      return role;
  }
}
