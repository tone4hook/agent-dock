import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MetaContext, MetaContextKind, MetaContextScope } from "@agent-dock/shared";

interface MetaContextRow {
  id: string;
  scope_type: MetaContextScope;
  scope_id: string;
  kind: MetaContextKind;
  body_md: string;
  created_at: string;
  updated_at: string;
}

function mapMetaContext(row: MetaContextRow): MetaContext {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    kind: row.kind,
    bodyMd: row.body_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateMetaContextRow {
  scopeType: MetaContextScope;
  scopeId: string;
  kind?: MetaContextKind;
  bodyMd: string;
}

export class MetaContextsRepo {
  constructor(private readonly db: Database.Database) {}

  listForScope(scopeType: MetaContextScope, scopeId: string): MetaContext[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM meta_contexts WHERE scope_type = ? AND scope_id = ? ORDER BY created_at ASC",
        )
        .all(scopeType, scopeId) as MetaContextRow[]
    ).map(mapMetaContext);
  }

  get(id: string): MetaContext | null {
    const row = this.db
      .prepare("SELECT * FROM meta_contexts WHERE id = ?")
      .get(id) as MetaContextRow | undefined;
    return row ? mapMetaContext(row) : null;
  }

  create(input: CreateMetaContextRow): MetaContext {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO meta_contexts (id, scope_type, scope_id, kind, body_md)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.scopeType, input.scopeId, input.kind ?? "manual", input.bodyMd);
    const created = this.get(id);
    if (!created) throw new Error("Failed to create meta_context");
    return created;
  }

  update(id: string, bodyMd: string): MetaContext {
    this.db
      .prepare(
        `UPDATE meta_contexts SET body_md = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(bodyMd, id);
    const updated = this.get(id);
    if (!updated) throw new Error("MetaContext not found");
    return updated;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM meta_contexts WHERE id = ?").run(id);
  }
}
