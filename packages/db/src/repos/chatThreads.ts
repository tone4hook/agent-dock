import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChatModel, ChatScope, ChatThread, ReasoningEffort } from "@agent-dock/shared";

interface ChatThreadRow {
  id: string;
  title: string;
  model: ChatModel;
  reasoning_effort: ReasoningEffort | null;
  scope: ChatScope;
  scope_project_id: string | null;
  created_at: string;
  updated_at: string;
}

function map(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    scope: row.scope,
    scopeProjectId: row.scope_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateChatThreadRow {
  title: string;
  model: ChatModel;
  reasoningEffort: ReasoningEffort | null;
  scope: ChatScope;
  scopeProjectId: string | null;
}

export interface UpdateChatThreadRow {
  title?: string;
  model?: ChatModel;
  reasoningEffort?: ReasoningEffort | null;
  scope?: ChatScope;
  scopeProjectId?: string | null;
}

export class ChatThreadsRepo {
  constructor(private readonly db: Database.Database) {}

  list(): ChatThread[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_threads ORDER BY updated_at DESC")
        .all() as ChatThreadRow[]
    ).map(map);
  }

  get(id: string): ChatThread | null {
    const row = this.db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(id) as
      | ChatThreadRow
      | undefined;
    return row ? map(row) : null;
  }

  create(input: CreateChatThreadRow): ChatThread {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO chat_threads
           (id, title, model, reasoning_effort, scope, scope_project_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.model,
        input.reasoningEffort,
        input.scope,
        input.scopeProjectId,
      );
    const created = this.get(id);
    if (!created) throw new Error("Failed to create chat thread");
    return created;
  }

  update(id: string, patch: UpdateChatThreadRow): ChatThread {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.model !== undefined) {
      sets.push("model = ?");
      values.push(patch.model);
    }
    if (patch.reasoningEffort !== undefined) {
      sets.push("reasoning_effort = ?");
      values.push(patch.reasoningEffort);
    }
    if (patch.scope !== undefined) {
      sets.push("scope = ?");
      values.push(patch.scope);
    }
    if (patch.scopeProjectId !== undefined) {
      sets.push("scope_project_id = ?");
      values.push(patch.scopeProjectId);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE chat_threads SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Chat thread not found");
    return updated;
  }

  touch(id: string): void {
    this.db
      .prepare("UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
  }
}
