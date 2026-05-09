import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NotesRepo,
  ProjectsRepo,
  StickyNotesRepo,
  TasksRepo,
  TodoListsRepo,
  migrate,
} from "@agent-dock/db";
import { NotesService } from "../src/services/notes.js";
import { createNotesRouter } from "../src/routes/notes.js";
import { createStickyNotesRouter } from "../src/routes/stickyNotes.js";
import { createTodoListsRouter } from "../src/routes/todoLists.js";

let db: Database.Database;
let app: express.Express;
let projectId: string;
let taskId: string;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);

  const projects = new ProjectsRepo(db);
  const tasks = new TasksRepo(db);
  const project = projects.create({ rootPath: "/tmp/p", name: "alpha" });
  projectId = project.id;
  taskId = tasks.create({ projectId: project.id, title: "task" }).id;

  const service = new NotesService({
    notes: new NotesRepo(db),
    stickies: new StickyNotesRepo(db),
    todoLists: new TodoListsRepo(db),
  });

  app = express();
  app.use(express.json());
  app.use("/api/notes", createNotesRouter({ service }));
  app.use("/api/sticky-notes", createStickyNotesRouter({ service }));
  app.use("/api/todo-lists", createTodoListsRouter({ service }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        err &&
        typeof err === "object" &&
        "status" in err &&
        typeof (err as { status: unknown }).status === "number"
          ? (err as { status: number }).status
          : 400;
      res.status(status).json({ error: message });
    },
  );
});

afterEach(() => db?.close());

describe("notes CRUD round-trip", () => {
  it("creates a manual note with tags + task link, lists it, deletes it", async () => {
    const created = await request(app)
      .post("/api/notes")
      .send({
        title: "first",
        body: "hello",
        tags: ["alpha", "beta"],
        taskIds: [taskId],
        projectId,
      })
      .expect(201);
    expect(created.body.note).toMatchObject({
      title: "first",
      body: "hello",
      source: "manual",
      tags: ["alpha", "beta"],
      taskIds: [taskId],
    });

    const list = await request(app).get("/api/notes").expect(200);
    expect(list.body.notes).toHaveLength(1);

    await request(app)
      .delete(`/api/notes/${created.body.note.id}`)
      .expect(200);
    expect((await request(app).get("/api/notes")).body.notes).toEqual([]);
  });

  it("create-from-chat-message sets source=chat_response and chatMessageId", async () => {
    const r = await request(app)
      .post("/api/notes/from-chat-message")
      .send({
        chatMessageId: "msg-1",
        title: "saved",
        body: "the response",
      })
      .expect(201);
    expect(r.body.note).toMatchObject({
      source: "chat_response",
      chatMessageId: "msg-1",
    });
  });

  it("link sub-routes round-trip", async () => {
    const r = await request(app)
      .post("/api/notes")
      .send({ title: "with links" })
      .expect(201);
    const id = r.body.note.id;

    const added = await request(app)
      .post(`/api/notes/${id}/jira-links/EEPD-1`)
      .expect(200);
    expect(added.body.note.jiraKeys).toEqual(["EEPD-1"]);

    const removed = await request(app)
      .delete(`/api/notes/${id}/jira-links/EEPD-1`)
      .expect(200);
    expect(removed.body.note.jiraKeys).toEqual([]);
  });
});

describe("sticky notes cap (3)", () => {
  it("4th sticky returns 409 with cap-reached message", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/sticky-notes")
        .send({ body: `note-${i}` })
        .expect(201);
    }
    const r = await request(app).post("/api/sticky-notes").send({ body: "overflow" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/cap reached/i);

    const listed = await request(app).get("/api/sticky-notes").expect(200);
    expect(listed.body.stickies).toHaveLength(3);
  });

  it("delete-then-create frees a slot", async () => {
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post("/api/sticky-notes")
        .send({ body: `note-${i}` })
        .expect(201);
      created.push(r.body.sticky.id);
    }
    await request(app).delete(`/api/sticky-notes/${created[0]}`).expect(200);
    await request(app)
      .post("/api/sticky-notes")
      .send({ body: "post-delete" })
      .expect(201);
  });
});

describe("todo lists cap (3) + items", () => {
  it("4th list returns 409 and items round-trip per list", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post("/api/todo-lists")
        .send({ name: `list-${i}` })
        .expect(201);
      ids.push(r.body.list.id);
    }
    expect(
      (await request(app).post("/api/todo-lists").send({ name: "overflow" })).status,
    ).toBe(409);

    // Add 2 items to list 0; one done, one not. Toggle one. Delete one.
    const a = await request(app)
      .post(`/api/todo-lists/${ids[0]}/items`)
      .send({ body: "item A" })
      .expect(201);
    await request(app)
      .post(`/api/todo-lists/${ids[0]}/items`)
      .send({ body: "item B" })
      .expect(201);
    const updated = await request(app)
      .patch(`/api/todo-lists/${ids[0]}/items/${a.body.item.id}`)
      .send({ done: true })
      .expect(200);
    expect(updated.body.item.done).toBe(true);

    const listed = await request(app).get(`/api/todo-lists/${ids[0]}`).expect(200);
    expect(listed.body.list.items).toHaveLength(2);

    await request(app)
      .delete(`/api/todo-lists/${ids[0]}/items/${a.body.item.id}`)
      .expect(200);
    const after = await request(app).get(`/api/todo-lists/${ids[0]}`).expect(200);
    expect(after.body.list.items).toHaveLength(1);
  });

  it("deleting a list cascades its items", async () => {
    const list = await request(app)
      .post("/api/todo-lists")
      .send({ name: "to-delete" })
      .expect(201);
    await request(app)
      .post(`/api/todo-lists/${list.body.list.id}/items`)
      .send({ body: "x" })
      .expect(201);
    await request(app).delete(`/api/todo-lists/${list.body.list.id}`).expect(200);
    const remaining = (db
      .prepare("SELECT COUNT(*) AS n FROM todo_items")
      .get() as { n: number }).n;
    expect(remaining).toBe(0);
  });
});
