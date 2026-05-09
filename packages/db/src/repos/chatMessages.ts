import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRole } from "@agent-dock/shared";

interface ChatMessageRow {
  id: string;
  thread_id: string;
  ord: number;
  role: ChatRole;
  content: string;
  tool_uses: string | null;
  model: string | null;
  created_at: string;
}

function map(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    ord: row.ord,
    role: row.role,
    content: row.content,
    toolUses: row.tool_uses,
    model: row.model,
    createdAt: row.created_at,
  };
}

export interface AppendChatMessageRow {
  threadId: string;
  role: ChatRole;
  content: string;
  toolUses?: string | null;
  model?: string | null;
}

export class ChatMessagesRepo {
  constructor(private readonly db: Database.Database) {}

  listForThread(threadId: string): ChatMessage[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY ord ASC")
        .all(threadId) as ChatMessageRow[]
    ).map(map);
  }

  get(id: string): ChatMessage | null {
    const row = this.db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as
      | ChatMessageRow
      | undefined;
    return row ? map(row) : null;
  }

  /**
   * Append a message at the next ordinal for the thread. Atomic via a
   * transaction so two concurrent appends don't collide on the
   * unique (thread_id, ord) index.
   */
  append(input: AppendChatMessageRow): ChatMessage {
    const id = randomUUID();
    const txn = this.db.transaction((row: AppendChatMessageRow) => {
      const next = this.db
        .prepare(
          "SELECT COALESCE(MAX(ord), -1) + 1 AS ord FROM chat_messages WHERE thread_id = ?",
        )
        .get(row.threadId) as { ord: number };
      this.db
        .prepare(
          `INSERT INTO chat_messages (id, thread_id, ord, role, content, tool_uses, model)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          row.threadId,
          next.ord,
          row.role,
          row.content,
          row.toolUses ?? null,
          row.model ?? null,
        );
    });
    txn(input);
    const created = this.get(id);
    if (!created) throw new Error("Failed to append chat message");
    return created;
  }

  /**
   * Update the content/toolUses of an existing message. Used by the
   * assistant streaming flow which inserts a placeholder row and then
   * fills it in once the run completes.
   */
  updateContent(id: string, patch: { content?: string; toolUses?: string | null }): ChatMessage {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.content !== undefined) {
      sets.push("content = ?");
      values.push(patch.content);
    }
    if (patch.toolUses !== undefined) {
      sets.push("tool_uses = ?");
      values.push(patch.toolUses);
    }
    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE chat_messages SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.get(id);
    if (!updated) throw new Error("Chat message not found");
    return updated;
  }

  /**
   * Null out notes.chat_message_id rows that pointed at messages in
   * this thread. Called by the chat service before deleting the thread
   * (the FK could not be retrofitted onto migration 003 — see
   * migrate.ts comment in 004_chat).
   */
  nullifyNoteRefsForThread(threadId: string): void {
    this.db
      .prepare(
        `UPDATE notes SET chat_message_id = NULL
         WHERE chat_message_id IN (
           SELECT id FROM chat_messages WHERE thread_id = ?
         )`,
      )
      .run(threadId);
  }
}
