import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Note, NoteSource } from "@agent-dock/shared";

interface NoteRow {
  id: string;
  source: NoteSource;
  title: string;
  body: string;
  chat_message_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    body: row.body,
    chatMessageId: row.chat_message_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateNoteRow {
  source: NoteSource;
  title: string;
  body?: string;
  chatMessageId?: string | null;
  projectId?: string | null;
}

export interface UpdateNoteRow {
  title?: string;
  body?: string;
  projectId?: string | null;
}

export interface NoteListFilter {
  source?: NoteSource;
  projectId?: string;
  q?: string;
  tag?: string;
}

export class NotesRepo {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
  }

  list(filter: NoteListFilter = {}): Note[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.source) {
      where.push("source = ?");
      params.push(filter.source);
    }
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.q) {
      where.push("(title LIKE ? OR body LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like);
    }
    if (filter.tag) {
      where.push("id IN (SELECT note_id FROM note_tags WHERE tag = ?)");
      params.push(filter.tag);
    }
    const sql =
      "SELECT * FROM notes" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY updated_at DESC";
    return (this.db.prepare(sql).all(...params) as NoteRow[]).map(mapNote);
  }

  get(id: string): Note | null {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as
      | NoteRow
      | undefined;
    return row ? mapNote(row) : null;
  }

  create(input: CreateNoteRow): Note {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO notes (id, source, title, body, chat_message_id, project_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.source,
        input.title,
        input.body ?? "",
        input.chatMessageId ?? null,
        input.projectId ?? null,
      );
    const created = this.get(id);
    if (!created) throw new Error("Failed to create note");
    return created;
  }

  update(id: string, patch: UpdateNoteRow): Note {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.body !== undefined) {
      sets.push("body = ?");
      values.push(patch.body);
    }
    if (patch.projectId !== undefined) {
      sets.push("project_id = ?");
      values.push(patch.projectId);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Note not found");
    return updated;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  }

  // ----- Links -----

  listJiraLinks(noteId: string): string[] {
    return (
      this.db
        .prepare("SELECT jira_key FROM note_jira_links WHERE note_id = ?")
        .all(noteId) as Array<{ jira_key: string }>
    ).map((r) => r.jira_key);
  }
  addJiraLink(noteId: string, jiraKey: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO note_jira_links (note_id, jira_key) VALUES (?, ?)")
      .run(noteId, jiraKey);
  }
  removeJiraLink(noteId: string, jiraKey: string): void {
    this.db
      .prepare("DELETE FROM note_jira_links WHERE note_id = ? AND jira_key = ?")
      .run(noteId, jiraKey);
  }

  listConfluenceLinks(noteId: string): string[] {
    return (
      this.db
        .prepare("SELECT page_id FROM note_confluence_links WHERE note_id = ?")
        .all(noteId) as Array<{ page_id: string }>
    ).map((r) => r.page_id);
  }
  addConfluenceLink(noteId: string, pageId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO note_confluence_links (note_id, page_id) VALUES (?, ?)")
      .run(noteId, pageId);
  }
  removeConfluenceLink(noteId: string, pageId: string): void {
    this.db
      .prepare("DELETE FROM note_confluence_links WHERE note_id = ? AND page_id = ?")
      .run(noteId, pageId);
  }

  listTaskLinks(noteId: string): string[] {
    return (
      this.db
        .prepare("SELECT task_id FROM note_task_links WHERE note_id = ?")
        .all(noteId) as Array<{ task_id: string }>
    ).map((r) => r.task_id);
  }
  addTaskLink(noteId: string, taskId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO note_task_links (note_id, task_id) VALUES (?, ?)")
      .run(noteId, taskId);
  }
  removeTaskLink(noteId: string, taskId: string): void {
    this.db
      .prepare("DELETE FROM note_task_links WHERE note_id = ? AND task_id = ?")
      .run(noteId, taskId);
  }

  listTags(noteId: string): string[] {
    return (
      this.db
        .prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag ASC")
        .all(noteId) as Array<{ tag: string }>
    ).map((r) => r.tag);
  }
  addTag(noteId: string, tag: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)")
      .run(noteId, tag);
  }
  removeTag(noteId: string, tag: string): void {
    this.db
      .prepare("DELETE FROM note_tags WHERE note_id = ? AND tag = ?")
      .run(noteId, tag);
  }
}
