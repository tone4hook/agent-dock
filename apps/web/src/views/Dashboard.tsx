import { RefreshCw } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NowRunningRail } from "@/components/dashboard/NowRunningRail";
import { ProjectsList } from "@/components/dashboard/ProjectsList";
import { RecentActivityFeed } from "@/components/dashboard/RecentActivityFeed";
import { StatTile } from "@/components/dashboard/StatTile";
import { useDashboard } from "@/lib/useDashboard";
import type { Navigate } from "@/lib/router";

interface DashboardProps {
  workspaceDir: string | null;
  navigate: Navigate;
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
}

export function Dashboard({
  workspaceDir,
  navigate,
  activeProjectId,
  onSelectProject,
}: DashboardProps) {
  const { summary, loading, error, reload } = useDashboard();

  return (
    <>
      <TopBar
        title="Dashboard"
        sub={
          summary
            ? `${summary.activeSessions} active · ${summary.awaitingApproval} awaiting · ${summary.openTasks} open tasks · ${workspaceDir ?? "no workspace"}`
            : (workspaceDir ?? undefined)
        }
        right={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Stat tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {loading && !summary ? (
              <>
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </>
            ) : summary ? (
              <>
                <StatTile
                  value={summary.activeSessions}
                  label="Active sessions"
                  sub={summary.activeSessions > 0 ? "running or paused" : "idle"}
                />
                <StatTile
                  value={summary.awaitingApproval}
                  label="Awaiting approval"
                  sub={
                    summary.reviewFailed > 0
                      ? `${summary.awaitingApproval} awaiting · ${summary.reviewFailed} review-failed`
                      : summary.awaitingApproval > 0
                        ? "plan ready to review"
                        : "no plans pending"
                  }
                  tone={
                    summary.reviewFailed > 0
                      ? "bad"
                      : summary.awaitingApproval > 0
                        ? "warn"
                        : "default"
                  }
                />
                <StatTile
                  value={summary.openTasks}
                  label="Open tasks"
                  sub={`across ${summary.projects.length} project${summary.projects.length === 1 ? "" : "s"}`}
                />
                <StatTile
                  value={summary.notesCount}
                  label="Notes"
                  sub="ships in phase 26"
                />
              </>
            ) : null}
          </div>

          {summary && (
            <>
              <NowRunningRail sessions={summary.runningSessions} navigate={navigate} />

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <ProjectsList
                  projects={summary.projects}
                  activeProjectId={activeProjectId}
                  onSelect={onSelectProject}
                />
                <RecentActivityFeed items={summary.recentActivity} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
