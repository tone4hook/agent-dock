import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ProjectsRepo, SettingsRepo } from "@agent-dock/db";
import type { Project } from "@agent-dock/shared";

export interface WorkspaceServiceDeps {
  settings: SettingsRepo;
  projects: ProjectsRepo;
}

export interface WorkspaceState {
  workspaceDir: string | null;
  projects: Project[];
}

const SKIP_DIRS = new Set([
  "worktrees",
  ".agent-dock",
  ".git",
  "node_modules",
  ".vscode",
  ".idea",
]);

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  getState(): WorkspaceState {
    const settings = this.deps.settings.getRuntime();
    const projects = this.deps.projects.list({ includeArchived: true });
    return { workspaceDir: settings.workspaceDir, projects };
  }

  setWorkspaceDir(dir: string): WorkspaceState {
    const absolute = resolve(dir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new Error(`Workspace directory does not exist: ${absolute}`);
    }
    const current = this.deps.settings.getRuntime();
    this.deps.settings.setRuntime({ ...current, workspaceDir: absolute });
    this.discoverProjects(absolute);
    return this.getState();
  }

  /**
   * Scan one level deep under workspaceDir for git repos and upsert any
   * new ones into the projects table. Existing rows are left alone (so
   * a manual archive/rename survives a rescan).
   */
  discoverProjects(workspaceDir: string): Project[] {
    const absolute = resolve(workspaceDir);
    if (!existsSync(absolute)) return this.deps.projects.list({ includeArchived: true });

    const entries = readdirSync(absolute, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const projectRoot = join(absolute, entry.name);
      const gitDir = join(projectRoot, ".git");
      if (!existsSync(gitDir)) continue;
      if (this.deps.projects.findByRootPath(projectRoot)) continue;
      this.deps.projects.create({ rootPath: projectRoot, name: entry.name });
    }
    return this.deps.projects.list({ includeArchived: true });
  }

  /**
   * Manually register a project by absolute path (escape hatch for
   * repos outside the workspace dir or nested deeper than one level).
   */
  addProject(rootPath: string, name?: string): Project {
    const absolute = resolve(rootPath);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new Error(`Project path does not exist: ${absolute}`);
    }
    if (!existsSync(join(absolute, ".git"))) {
      throw new Error(`Path is not a git repo: ${absolute}`);
    }
    const existing = this.deps.projects.findByRootPath(absolute);
    if (existing) return existing;
    return this.deps.projects.create({
      rootPath: absolute,
      name: name ?? basename(absolute),
    });
  }
}
