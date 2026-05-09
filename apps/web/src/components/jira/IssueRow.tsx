import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JiraSearchHit } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface IssueRowProps {
  issue: JiraSearchHit;
  saved?: boolean;
  navigate: Navigate;
}

const STATUS_TONE = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes("progress") || s.includes("review")) return "border-primary/40 bg-primary/10 text-primary";
  if (s.includes("done") || s.includes("closed") || s.includes("resolved"))
    return "border-success/40 bg-success/10 text-success";
  if (s.includes("validation") || s.includes("blocked"))
    return "border-warn/40 bg-warn/10 text-warn";
  return "border-border bg-muted text-muted-foreground";
};

export function IssueRow({ issue, saved, navigate }: IssueRowProps) {
  return (
    <button
      type="button"
      onClick={() => navigate({ view: "jira-detail", key: issue.key })}
      className="grid w-full grid-cols-[7rem_minmax(0,9rem)_minmax(0,1fr)_auto_minmax(0,8rem)] items-center gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
    >
      <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
          STATUS_TONE(issue.status),
        )}
      >
        {issue.status || "—"}
      </span>
      <span className="truncate font-medium">{issue.summary}</span>
      <div className="flex items-center gap-1">
        {saved ? (
          <Badge>
            <Star className="h-3 w-3" /> saved
          </Badge>
        ) : null}
      </div>
      <span className="truncate text-xs text-muted-foreground">{issue.assignee ?? "unassigned"}</span>
    </button>
  );
}
