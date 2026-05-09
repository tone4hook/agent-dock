import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.js";
import { ChatThreadsRepo } from "../src/repos/chatThreads.js";
import { ChatMessagesRepo } from "../src/repos/chatMessages.js";
import { ProjectsRepo } from "../src/repos/projects.js";
import { NotesRepo } from "../src/repos/notes.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
});

afterEach(() => db.close());

describe("ChatThreadsRepo", () => {
  it("creates, lists, gets, updates, deletes", () => {
    const repo = new ChatThreadsRepo(db);
    const t = repo.create({
      title: "exploring",
      model: "claude-sonnet-4-6",
      reasoningEffort: null,
      scope: "general",
      scopeProjectId: null,
    });
    expect(t.title).toBe("exploring");
    expect(t.model).toBe("claude-sonnet-4-6");
    expect(t.scope).toBe("general");

    expect(repo.list()).toHaveLength(1);
    expect(repo.get(t.id)?.id).toBe(t.id);

    repo.update(t.id, { title: "renamed", model: "claude-opus-4-7", reasoningEffort: "medium" });
    const updated = repo.get(t.id);
    expect(updated?.title).toBe("renamed");
    expect(updated?.model).toBe("claude-opus-4-7");
    expect(updated?.reasoningEffort).toBe("medium");

    repo.delete(t.id);
    expect(repo.list()).toHaveLength(0);
  });

  it("rejects invalid model/scope/role via CHECK constraints", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO chat_threads (id, title, model, scope) VALUES (?, ?, ?, ?)",
        )
        .run("x", "t", "gpt-4", "general"),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO chat_threads (id, title, model, scope) VALUES (?, ?, ?, ?)",
        )
        .run("x", "t", "claude-opus-4-7", "world"),
    ).toThrow(/CHECK constraint/);
  });

  it("scope_project_id is set null when project deleted", () => {
    const projects = new ProjectsRepo(db);
    const repo = new ChatThreadsRepo(db);
    const p = projects.create({ rootPath: "/tmp/p", name: "p" });
    const t = repo.create({
      title: "t",
      model: "claude-sonnet-4-6",
      reasoningEffort: null,
      scope: "project",
      scopeProjectId: p.id,
    });
    db.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
    expect(repo.get(t.id)?.scopeProjectId).toBeNull();
  });
});

describe("ChatMessagesRepo", () => {
  it("appends in order, cascades on thread delete, nullifies note refs", () => {
    const threads = new ChatThreadsRepo(db);
    const messages = new ChatMessagesRepo(db);
    const notes = new NotesRepo(db);
    const t = threads.create({
      title: "t",
      model: "claude-sonnet-4-6",
      reasoningEffort: null,
      scope: "general",
      scopeProjectId: null,
    });

    const m1 = messages.append({ threadId: t.id, role: "user", content: "hi" });
    const m2 = messages.append({
      threadId: t.id,
      role: "assistant",
      content: "hello",
      model: "claude-sonnet-4-6",
    });
    const m3 = messages.append({ threadId: t.id, role: "user", content: "follow-up" });
    expect([m1.ord, m2.ord, m3.ord]).toEqual([0, 1, 2]);
    expect(messages.listForThread(t.id).map((m) => m.content)).toEqual([
      "hi",
      "hello",
      "follow-up",
    ]);

    const updated = messages.updateContent(m2.id, { content: "hello there" });
    expect(updated.content).toBe("hello there");

    // Save a note that points at m2.
    const note = notes.create({
      source: "chat_response",
      title: "saved",
      body: "hello there",
      chatMessageId: m2.id,
    });
    expect(notes.get(note.id)?.chatMessageId).toBe(m2.id);

    // nullifyNoteRefsForThread clears the soft pointer before delete.
    messages.nullifyNoteRefsForThread(t.id);
    expect(notes.get(note.id)?.chatMessageId).toBeNull();

    // FK cascade still drops messages when the thread is deleted.
    threads.delete(t.id);
    expect(messages.listForThread(t.id)).toHaveLength(0);
    // The note itself survives — we only nulled the back-reference.
    expect(notes.get(note.id)?.title).toBe("saved");
  });

  it("rejects invalid role via CHECK", () => {
    const threads = new ChatThreadsRepo(db);
    const t = threads.create({
      title: "t",
      model: "claude-sonnet-4-6",
      reasoningEffort: null,
      scope: "general",
      scopeProjectId: null,
    });
    expect(() =>
      db
        .prepare(
          "INSERT INTO chat_messages (id, thread_id, ord, role, content) VALUES (?, ?, ?, ?, ?)",
        )
        .run("x", t.id, 0, "tool", "x"),
    ).toThrow(/CHECK constraint/);
  });
});
