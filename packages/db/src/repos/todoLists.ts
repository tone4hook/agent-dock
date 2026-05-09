import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TodoItem, TodoList } from "@agent-dock/shared";

interface TodoListRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface TodoItemRow {
  id: string;
  list_id: string;
  body: string;
  done: number;
  ord: number;
  created_at: string;
  updated_at: string;
}

function mapList(row: TodoListRow): TodoList {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: TodoItemRow): TodoItem {
  return {
    id: row.id,
    listId: row.list_id,
    body: row.body,
    done: row.done === 1,
    ord: row.ord,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTodoListRow {
  name: string;
}
export interface UpdateTodoListRow {
  name?: string;
}
export interface CreateTodoItemRow {
  listId: string;
  body: string;
  done?: boolean;
  ord?: number;
}
export interface UpdateTodoItemRow {
  body?: string;
  done?: boolean;
  ord?: number;
}

export class TodoListsRepo {
  constructor(private readonly db: Database.Database) {}

  countLists(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM todo_lists").get() as { n: number }).n;
  }

  listLists(): TodoList[] {
    return (
      this.db
        .prepare("SELECT * FROM todo_lists ORDER BY created_at ASC")
        .all() as TodoListRow[]
    ).map(mapList);
  }

  getList(id: string): TodoList | null {
    const row = this.db.prepare("SELECT * FROM todo_lists WHERE id = ?").get(id) as
      | TodoListRow
      | undefined;
    return row ? mapList(row) : null;
  }

  createList(input: CreateTodoListRow): TodoList {
    const id = randomUUID();
    this.db.prepare("INSERT INTO todo_lists (id, name) VALUES (?, ?)").run(id, input.name);
    const created = this.getList(id);
    if (!created) throw new Error("Failed to create todo list");
    return created;
  }

  updateList(id: string, patch: UpdateTodoListRow): TodoList {
    if (patch.name !== undefined) {
      this.db
        .prepare(
          "UPDATE todo_lists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(patch.name, id);
    }
    const updated = this.getList(id);
    if (!updated) throw new Error("Todo list not found");
    return updated;
  }

  deleteList(id: string): void {
    this.db.prepare("DELETE FROM todo_lists WHERE id = ?").run(id);
  }

  // ----- Items -----

  listItems(listId: string): TodoItem[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM todo_items WHERE list_id = ? ORDER BY ord ASC, created_at ASC",
        )
        .all(listId) as TodoItemRow[]
    ).map(mapItem);
  }

  getItem(id: string): TodoItem | null {
    const row = this.db.prepare("SELECT * FROM todo_items WHERE id = ?").get(id) as
      | TodoItemRow
      | undefined;
    return row ? mapItem(row) : null;
  }

  createItem(input: CreateTodoItemRow): TodoItem {
    const id = randomUUID();
    const next = (
      this.db
        .prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM todo_items WHERE list_id = ?")
        .get(input.listId) as { m: number }
    ).m + 1;
    this.db
      .prepare(
        "INSERT INTO todo_items (id, list_id, body, done, ord) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.listId,
        input.body,
        input.done ? 1 : 0,
        input.ord ?? next,
      );
    const created = this.getItem(id);
    if (!created) throw new Error("Failed to create todo item");
    return created;
  }

  updateItem(id: string, patch: UpdateTodoItemRow): TodoItem {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.body !== undefined) {
      sets.push("body = ?");
      values.push(patch.body);
    }
    if (patch.done !== undefined) {
      sets.push("done = ?");
      values.push(patch.done ? 1 : 0);
    }
    if (patch.ord !== undefined) {
      sets.push("ord = ?");
      values.push(patch.ord);
    }
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE todo_items SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const updated = this.getItem(id);
    if (!updated) throw new Error("Todo item not found");
    return updated;
  }

  deleteItem(id: string): void {
    this.db.prepare("DELETE FROM todo_items WHERE id = ?").run(id);
  }
}
