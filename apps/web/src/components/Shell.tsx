import * as React from "react";
import type { Project } from "@agent-dock/shared";
import { Sidebar } from "@/components/Sidebar";
import { WorkspaceProjectSwitcher } from "@/components/WorkspaceProjectSwitcher";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { NavBadges } from "@/lib/routes";
import type { Navigate, Route } from "@/lib/router";

interface ShellProps {
  route: Route;
  navigate: Navigate;
  workspaceDir: string | null;
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  navBadges?: NavBadges;
  children: React.ReactNode;
}

export function Shell({
  route,
  navigate,
  workspaceDir,
  projects,
  activeProjectId,
  onSelectProject,
  navBadges,
  children,
}: ShellProps) {
  const collapsed = useMediaQuery("(max-width: 900px)");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        route={route}
        navigate={navigate}
        collapsed={collapsed}
        badges={navBadges}
        switcherSlot={
          collapsed ? null : (
            <WorkspaceProjectSwitcher
              workspaceDir={workspaceDir}
              projects={projects}
              activeId={activeProjectId}
              onSelect={onSelectProject}
            />
          )
        }
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
