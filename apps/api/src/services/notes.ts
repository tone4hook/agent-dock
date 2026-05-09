import type { NotesRepo, StickyNotesRepo, TodoListsRepo } from "@agent-dock/db";
import {
  STICKY_CAP,
  TODO_LIST_CAP,
  type CreateNoteFromChatMessageInput,
  type CreateNoteInput,
  type CreateStickyNoteInput,
  type CreateTodoItemInput,
  type CreateTodoListInput,
  type Note,
  type NoteSource,
  type StickyNote,
  type TodoItem,
  type TodoList,
  type UpdateNoteInput,
  type UpdateStickyNoteInput,
  type UpdateTodoItemInput,
  type UpdateTodoListInput,
} from "@agent-dock/shared";

/**
 * Thrown when the workspace would exceed a UX-level cap (sticky notes
 * or todo lists). The Express error funnel converts to HTTP 409.
 */
export class LimitExceededError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "LimitExceededError";
  }
}

export interface NoteWithRelations extends Note {
  tags: string[];
  jiraKeys: string[];
  pageIds: string[];
  taskIds: string[];
}

export interface NotesServiceDeps {
  notes: NotesRepo;
  stickies: StickyNotesRepo;
  todoLists: TodoListsRepo;
}

export class NotesService {
  constructor(private readonly deps: NotesServiceDeps) {}

  // ---------- Notes ----------

  list(filter: { source?: NoteSource; projectId?: string; q?: string; tag?: string } = {}): NoteWithRelations[] {
    return this.deps.notes.list(filter).map((n) => this.augment(n));
  }

  get(id: string): NoteWithRelations | null {
    const note = this.deps.notes.get(id);
    return note ? this.augment(note) : null;
  }

  create(input: CreateNoteInput): NoteWithRelations {
    const note = this.deps.notes.create({
      source: input.source,
      title: input.title,
      body: input.body,
      chatMessageId: input.chatMessageId ?? null,
      projectId: input.projectId ?? null,
    });
    this.applyRelations(note.id, input);
    return this.requireDetail(note.id);
  }

  createFromChatMessage(input: CreateNoteFromChatMessageInput): NoteWithRelations {
    const note = this.deps.notes.create({
      source: "chat_response",
      title: input.title,
      body: input.body,
      chatMessageId: input.chatMessageId,
      projectId: input.projectId ?? null,
    });
    this.applyRelations(note.id, input);
    return this.requireDetail(note.id);
  }

  update(id: string, patch: UpdateNoteInput): NoteWithRelations {
    this.deps.notes.update(id, patch);
    return this.requireDetail(id);
  }

  delete(id: string): void {
    this.deps.notes.delete(id);
  }

  addJiraLink(noteId: string, jiraKey: string): NoteWithRelations {
    this.deps.notes.addJiraLink(noteId, jiraKey);
    return this.requireDetail(noteId);
  }
  removeJiraLink(noteId: string, jiraKey: string): NoteWithRelations {
    this.deps.notes.removeJiraLink(noteId, jiraKey);
    return this.requireDetail(noteId);
  }
  addConfluenceLink(noteId: string, pageId: string): NoteWithRelations {
    this.deps.notes.addConfluenceLink(noteId, pageId);
    return this.requireDetail(noteId);
  }
  removeConfluenceLink(noteId: string, pageId: string): NoteWithRelations {
    this.deps.notes.removeConfluenceLink(noteId, pageId);
    return this.requireDetail(noteId);
  }
  addTaskLink(noteId: string, taskId: string): NoteWithRelations {
    this.deps.notes.addTaskLink(noteId, taskId);
    return this.requireDetail(noteId);
  }
  removeTaskLink(noteId: string, taskId: string): NoteWithRelations {
    this.deps.notes.removeTaskLink(noteId, taskId);
    return this.requireDetail(noteId);
  }
  addTag(noteId: string, tag: string): NoteWithRelations {
    this.deps.notes.addTag(noteId, tag);
    return this.requireDetail(noteId);
  }
  removeTag(noteId: string, tag: string): NoteWithRelations {
    this.deps.notes.removeTag(noteId, tag);
    return this.requireDetail(noteId);
  }

  // ---------- Sticky notes (cap 3) ----------

  listStickies(): StickyNote[] {
    return this.deps.stickies.list();
  }

  createSticky(input: CreateStickyNoteInput): StickyNote {
    if (this.deps.stickies.count() >= STICKY_CAP) {
      throw new LimitExceededError(`Sticky note cap reached (${STICKY_CAP}/${STICKY_CAP}). Delete one to free a slot.`);
    }
    return this.deps.stickies.create({
      body: input.body,
      color: input.color,
      tag: input.tag ?? null,
    });
  }

  updateSticky(id: string, patch: UpdateStickyNoteInput): StickyNote {
    return this.deps.stickies.update(id, patch);
  }

  deleteSticky(id: string): void {
    this.deps.stickies.delete(id);
  }

  // ---------- Todo lists (cap 3) ----------

  listTodoLists(): Array<TodoList & { items: TodoItem[] }> {
    return this.deps.todoLists.listLists().map((l) => ({
      ...l,
      items: this.deps.todoLists.listItems(l.id),
    }));
  }

  getTodoList(id: string): (TodoList & { items: TodoItem[] }) | null {
    const list = this.deps.todoLists.getList(id);
    if (!list) return null;
    return { ...list, items: this.deps.todoLists.listItems(id) };
  }

  createTodoList(input: CreateTodoListInput): TodoList & { items: TodoItem[] } {
    if (this.deps.todoLists.countLists() >= TODO_LIST_CAP) {
      throw new LimitExceededError(
        `ToDo list cap reached (${TODO_LIST_CAP}/${TODO_LIST_CAP}). Delete one to free a slot.`,
      );
    }
    const list = this.deps.todoLists.createList({ name: input.name });
    return { ...list, items: [] };
  }

  updateTodoList(id: string, patch: UpdateTodoListInput): TodoList & { items: TodoItem[] } {
    const list = this.deps.todoLists.updateList(id, patch);
    return { ...list, items: this.deps.todoLists.listItems(id) };
  }

  deleteTodoList(id: string): void {
    this.deps.todoLists.deleteList(id);
  }

  createTodoItem(listId: string, input: CreateTodoItemInput): TodoItem {
    return this.deps.todoLists.createItem({ listId, ...input });
  }

  updateTodoItem(id: string, patch: UpdateTodoItemInput): TodoItem {
    return this.deps.todoLists.updateItem(id, patch);
  }

  deleteTodoItem(id: string): void {
    this.deps.todoLists.deleteItem(id);
  }

  // ---------- internals ----------

  private requireDetail(id: string): NoteWithRelations {
    const detail = this.get(id);
    if (!detail) throw new Error("Note not found");
    return detail;
  }

  private augment(note: Note): NoteWithRelations {
    return {
      ...note,
      tags: this.deps.notes.listTags(note.id),
      jiraKeys: this.deps.notes.listJiraLinks(note.id),
      pageIds: this.deps.notes.listConfluenceLinks(note.id),
      taskIds: this.deps.notes.listTaskLinks(note.id),
    };
  }

  private applyRelations(
    noteId: string,
    input: { tags?: string[]; taskIds?: string[]; jiraKeys?: string[]; pageIds?: string[] },
  ): void {
    for (const t of input.tags ?? []) this.deps.notes.addTag(noteId, t);
    for (const k of input.jiraKeys ?? []) this.deps.notes.addJiraLink(noteId, k);
    for (const p of input.pageIds ?? []) this.deps.notes.addConfluenceLink(noteId, p);
    for (const t of input.taskIds ?? []) this.deps.notes.addTaskLink(noteId, t);
  }
}
