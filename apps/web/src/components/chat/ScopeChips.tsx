import * as React from "react";
import type { Project } from "@agent-dock/shared";
import type { ChatScope } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ScopeChipsProps {
  scope: ChatScope;
  scopeProjectId: string | null;
  projects: Project[];
  workspaceDir: string | null;
  onChange: (scope: ChatScope, projectId: string | null) => void;
  disabled?: boolean;
}

export function ScopeChips({
  scope,
  scopeProjectId,
  projects,
  workspaceDir,
  onChange,
  disabled,
}: ScopeChipsProps) {
  const activeProject = projects.find((p) => p.id === scopeProjectId) ?? projects[0];

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-5 py-2 text-xs">
      <span className="font-medium text-muted-foreground">Scope</span>
      <Chip
        active={scope === "general"}
        disabled={disabled}
        onClick={() => onChange("general", null)}
      >
        General
      </Chip>
      <Chip
        active={scope === "workspace"}
        disabled={disabled || !workspaceDir}
        onClick={() => onChange("workspace", null)}
        title={workspaceDir ?? "No workspace selected"}
      >
        Workspace
      </Chip>
      <Chip
        active={scope === "project"}
        disabled={disabled || !activeProject}
        onClick={() =>
          activeProject ? onChange("project", activeProject.id) : undefined
        }
        title={activeProject?.rootPath}
      >
        Project{activeProject ? ` · ${activeProject.name}` : ""}
      </Chip>
      {scope === "project" && projects.length > 1 && (
        <select
          className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          value={scopeProjectId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange("project", e.currentTarget.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 rounded-full border px-3 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}
