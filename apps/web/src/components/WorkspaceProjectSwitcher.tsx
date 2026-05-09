import { Check, ChevronDown, Folder } from "lucide-react";
import type { Project } from "@agent-dock/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface WorkspaceProjectSwitcherProps {
  workspaceDir: string | null;
  projects: Project[];
  activeId: string | null;
  onSelect: (projectId: string) => void;
  collapsed?: boolean;
}

export function WorkspaceProjectSwitcher({
  workspaceDir,
  projects,
  activeId,
  onSelect,
  collapsed,
}: WorkspaceProjectSwitcherProps) {
  const active = projects.find((p) => p.id === activeId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent",
            collapsed && "justify-center px-1",
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-mono text-muted-foreground">
                  {workspaceDir ?? "no workspace"}
                </div>
                <div className="truncate text-xs font-medium">
                  {active?.name ?? "Select project"}
                </div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <div className="px-2 pb-2 text-[10px] font-mono text-muted-foreground">
          {workspaceDir ?? "—"}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.length ? (
          projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => onSelect(p.id)}
              className="flex flex-col items-start gap-0"
            >
              <div className="flex w-full items-center gap-2">
                <span className="flex-1 truncate text-sm">{p.name}</span>
                {p.id === activeId && <Check className="h-3.5 w-3.5" />}
              </div>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {p.rootPath}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No projects discovered yet.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
