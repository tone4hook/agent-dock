import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { StickyNote } from "@agent-dock/shared";

interface StickyRow {
  id: string;
  body: string;
  color: string;
  tag: string | null;
  created_at: string;
  updated_at: string;
}

function mapSticky(row: StickyRow): StickyNote {
  return {
    id: row.id,
    body: row.body,
    color: row.color,
    tag: row.tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateStickyRow {
  body: string;
  color?: string;
  tag?: string | null;
}

export interface UpdateStickyRow {
  body?: string;
  color?: string;
  tag?: string | null;
}

export class StickyNotesRepo {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM sticky_notes").get() as { n: number }).n;
  }

  list(): StickyNote[] {
    return (
      this.db
        .prepare("SELECT * FROM sticky_notes ORDER BY created_at ASC")
        .all() as StickyRow[]
    ).map(mapSticky);
  }

  get(id: string): StickyNote | null {
    const row = this.db.prepare("SELECT * FROM sticky_notes WHERE id = ?").get(id) as
      | StickyRow
      | undefined;
    return row ? mapSticky(row) : null;
  }

  create(input: CreateStickyRow): StickyNote {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO sticky_notes (id, body, color, tag) VALUES (?, ?, ?, ?)")
      .run(id, input.body, input.color ?? "#fff5b8", input.tag ?? null);
    const created = this.get(id);
    if (!created) throw new Error("Failed to create sticky note");
    return created;
  }

  update(id: string, patch: UpdateStickyRow): StickyNote {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.body !== undefined) {
      sets.push("body = ?");
      values.push(patch.body);
    }
    if (patch.color !== undefined) {
      sets.push("color = ?");
      values.push(patch.color);
    }
    if (patch.tag !== undefined) {
      sets.push("tag = ?");
      values.push(patch.tag);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db
        .prepare(`UPDATE sticky_notes SET ${sets.join(", ")} WHERE id = ?`)
        .run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Sticky note not found");
    return updated;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sticky_notes WHERE id = ?").run(id);
  }
}
