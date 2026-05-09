import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Project } from "@agent-dock/shared";

interface ProjectRow {
  id: string;
  root_path: string;
  name: string;
  default_base_ref: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    rootPath: row.root_path,
    name: row.name,
    defaultBaseRef: row.default_base_ref,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateProjectRow {
  rootPath: string;
  name: string;
  defaultBaseRef?: string;
}

export interface UpdateProjectRow {
  name?: string;
  defaultBaseRef?: string;
  archived?: boolean;
}

export class ProjectsRepo {
  constructor(private readonly db: Database.Database) {}

  list(opts: { includeArchived?: boolean } = {}): Project[] {
    const sql = opts.includeArchived
      ? "SELECT * FROM projects ORDER BY name ASC"
      : "SELECT * FROM projects WHERE archived_at IS NULL ORDER BY name ASC";
    return (this.db.prepare(sql).all() as ProjectRow[]).map(mapProject);
  }

  get(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  findByRootPath(rootPath: string): Project | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(rootPath) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  create(input: CreateProjectRow): Project {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO projects (id, root_path, name, default_base_ref)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.rootPath, input.name, input.defaultBaseRef ?? "main");
    const created = this.get(id);
    if (!created) throw new Error("Failed to create project");
    return created;
  }

  update(id: string, patch: UpdateProjectRow): Project {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      values.push(patch.name);
    }
    if (patch.defaultBaseRef !== undefined) {
      sets.push("default_base_ref = ?");
      values.push(patch.defaultBaseRef);
    }
    if (patch.archived !== undefined) {
      sets.push("archived_at = ?");
      values.push(patch.archived ? new Date().toISOString() : null);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Project not found");
    return updated;
  }
}
