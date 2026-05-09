import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardRunningSession } from "@/lib/api";
import type { Navigate } from "@/lib/router";

const STEP_ROLES = ["investigate", "plan", "implement", "code_review"] as const;
type StepRole = (typeof STEP_ROLES)[number];

const STEP_LABEL: Record<StepRole, string> = {
  investigate: "investigate",
  plan: "plan",
  implement: "implement",
  code_review: "review",
};

interface NowRunningRailProps {
  sessions: DashboardRunningSession[];
  navigate: Navigate;
}

export function NowRunningRail({ sessions, navigate }: NowRunningRailProps) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Now running</h2>
        <span className="text-xs text-muted-foreground">live · auto-refresh</span>
      </CardHeader>
      <CardContent className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sessions. Start one from a task.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.sessionId}
              className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <StatusChip status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.taskTitle}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {s.projectName}
                </div>
              </div>
              <StepPips
                currentOrd={s.currentStepOrd}
                currentRole={s.currentStepRole}
                status={s.status}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ view: "session-detail", sessionId: s.sessionId })}
              >
                Open
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function StatusChip({ status }: { status: DashboardRunningSession["status"] }) {
  const map: Record<DashboardRunningSession["status"], { label: string; cls: string }> = {
    running: { label: "▶ running", cls: "border-success/40 bg-success/10 text-success" },
    paused: { label: "⏸ paused", cls: "border-muted-foreground/40 bg-muted text-muted-foreground" },
    awaiting_approval: { label: "● awaiting", cls: "border-warn/40 bg-warn/10 text-warn" },
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

function StepPips({
  currentOrd,
  currentRole,
  status,
}: {
  currentOrd: number | null;
  currentRole: StepRole | null;
  status: DashboardRunningSession["status"];
}) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      {STEP_ROLES.map((role, idx) => {
        const before = currentOrd != null && idx < currentOrd;
        const at = currentOrd != null && idx === currentOrd;
        return (
          <span
            key={role}
            title={STEP_LABEL[role]}
            className={cn(
              "h-2 rounded-full transition-all",
              before && "w-3.5 bg-success",
              at && status === "awaiting_approval" && "w-5 bg-warn",
              at && status !== "awaiting_approval" && "w-5 bg-primary",
              !before && !at && "w-3.5 bg-muted",
            )}
          />
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground">
        {currentRole ? STEP_LABEL[currentRole] : "—"}
      </span>
    </div>
  );
}
