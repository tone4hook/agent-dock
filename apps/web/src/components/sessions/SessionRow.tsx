import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionListItem } from "@/lib/api";
import type { Navigate } from "@/lib/router";

const STATUS_TONE: Record<
  SessionListItem["status"],
  { label: string; cls: string }
> = {
  running: { label: "▶ running", cls: "border-success/40 bg-success/10 text-success" },
  awaiting_approval: { label: "● awaiting", cls: "border-warn/40 bg-warn/10 text-warn" },
  awaiting_clarification: { label: "? clarify", cls: "border-warn/40 bg-warn/10 text-warn" },
  paused: { label: "⏸ paused", cls: "border-border bg-muted text-muted-foreground" },
  completed: { label: "✓ completed", cls: "border-success/40 bg-success/10 text-success" },
  failed: { label: "✗ failed", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  cancelled: { label: "✕ cancelled", cls: "border-border bg-muted text-muted-foreground" },
  draft: { label: "draft", cls: "border-border bg-muted text-muted-foreground" },
};

interface SessionRowProps {
  item: SessionListItem;
  navigate: Navigate;
}

export function SessionRow({ item, navigate }: SessionRowProps) {
  const tone = STATUS_TONE[item.status];
  const stepLabel = item.currentStepRole === "code_review" ? "review" : item.currentStepRole;

  return (
    <button
      type="button"
      onClick={() => navigate({ view: "session-detail", sessionId: item.sessionId })}
      className="grid w-full grid-cols-[8rem_minmax(0,1fr)_minmax(0,12rem)_minmax(0,8rem)_minmax(0,9rem)_auto] items-center gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
          tone.cls,
        )}
      >
        {tone.label}
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{item.taskTitle}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{item.branch}</div>
      </div>
      <span className="truncate text-muted-foreground">{item.projectName}</span>
      <span className="text-xs text-muted-foreground">
        {stepLabel ? `${stepLabel}${item.totalSteps ? ` (${(item.currentStepOrd ?? 0) + 1}/${item.totalSteps})` : ""}` : "—"}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {formatDateShort(item.createdAt)}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function formatDateShort(iso: string): string {
  const ts = iso.includes("T") ? new Date(iso) : new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return iso;
  return ts.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
