import { FolderGit2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { DashboardProject } from "@/lib/api";

interface ProjectsListProps {
  projects: DashboardProject[];
  activeProjectId: string | null;
  onSelect: (id: string) => void;
}

export function ProjectsList({ projects, activeProjectId, onSelect }: ProjectsListProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Projects</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet. Add a git repo to your workspace.
          </p>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={
                "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors " +
                (p.id === activeProjectId
                  ? "border-primary bg-secondary"
                  : "border-border bg-background hover:border-primary/40")
              }
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {p.defaultBaseRef} · {p.openTasks} open · {p.activeSessions} active
                </div>
              </div>
              {p.activeSessions > 0 && (
                <span className="rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
                  ● {p.activeSessions}
                </span>
              )}
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
