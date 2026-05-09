import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChatMessagesRepo,
  ChatThreadsRepo,
  ProjectsRepo,
  SettingsRepo,
  migrate,
} from "@agent-dock/db";
import type { RunChatTurnInput, ChatTurnResult } from "@agent-dock/agents";
import { ChatService } from "../src/services/chat.js";
import { createChatRouter } from "../src/routes/chat.js";

let db: Database.Database;
let app: express.Express;
let projectId: string;
let runnerCalls: RunChatTurnInput[];
let runnerImpl: (input: RunChatTurnInput) => Promise<ChatTurnResult>;

const errorMiddleware = (
  err: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 400;
  res.status(status).json({ error: message });
};

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);

  const settings = new SettingsRepo(db);
  settings.setRuntime({
    defaultProvider: "claude",
    defaultModelHint: null,
    defaultReasoningHint: null,
    defaultWorkingDirectory: null,
    defaultPermissionMode: "bypass",
    workspaceDir: "/tmp/wkspc",
    maxConcurrentSessions: 3,
  });

  const projects = new ProjectsRepo(db);
  projectId = projects.create({ rootPath: "/tmp/proj-x", name: "proj-x" }).id;

  runnerCalls = [];
  runnerImpl = async (input) => {
    input.onEvent({ kind: "delta", text: "hel" });
    input.onEvent({ kind: "delta", text: "lo" });
    input.onEvent({ kind: "final", text: "hello" });
    return { status: "completed", finalText: "hello" };
  };

  const chat = new ChatService({
    threads: new ChatThreadsRepo(db),
    messages: new ChatMessagesRepo(db),
    projects,
    workspaceDir: () => settings.getRuntime().workspaceDir,
    runChatTurn: async (input) => {
      runnerCalls.push(input);
      return runnerImpl(input);
    },
  });

  app = express();
  app.use(express.json());
  app.use("/api/chat", createChatRouter({ service: chat }));
  app.use(errorMiddleware);
});

afterEach(() => db?.close());

async function waitForRunner(): Promise<void> {
  // The service kicks off the assistant turn asynchronously. For tests
  // we drive it with a synchronous-ish mock — yield a few microtasks
  // so the run promise resolves and updateContent has run.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("POST /api/chat/threads", () => {
  it("creates a thread with defaults and rejects scope=project without scopeProjectId", async () => {
    const r = await request(app).post("/api/chat/threads").send({}).expect(201);
    expect(r.body.thread).toMatchObject({
      title: "New chat",
      model: "claude-sonnet-4-6",
      scope: "general",
      scopeProjectId: null,
    });
    const bad = await request(app)
      .post("/api/chat/threads")
      .send({ scope: "project" });
    expect(bad.status).toBe(400);
  });

  it("rejects unknown scopeProjectId", async () => {
    const r = await request(app)
      .post("/api/chat/threads")
      .send({ scope: "project", scopeProjectId: "not-a-real-id" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not found/i);
  });
});

describe("messages flow + scope→workingDirectory resolution", () => {
  it("general scope passes workingDirectory=null to the runner", async () => {
    const created = await request(app).post("/api/chat/threads").send({}).expect(201);
    const id = created.body.thread.id;
    await request(app)
      .post(`/api/chat/threads/${id}/messages`)
      .send({ content: "hi" })
      .expect(201);
    await waitForRunner();
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0].thread.workingDirectory).toBeNull();

    const detail = await request(app).get(`/api/chat/threads/${id}`).expect(200);
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0]).toMatchObject({ role: "user", content: "hi", ord: 0 });
    expect(detail.body.messages[1]).toMatchObject({
      role: "assistant",
      content: "hello",
      ord: 1,
    });
  });

  it("workspace scope resolves workspaceDir, project scope resolves project rootPath", async () => {
    const ws = await request(app)
      .post("/api/chat/threads")
      .send({ scope: "workspace", model: "claude-opus-4-7" })
      .expect(201);
    const proj = await request(app)
      .post("/api/chat/threads")
      .send({ scope: "project", scopeProjectId: projectId })
      .expect(201);

    await request(app)
      .post(`/api/chat/threads/${ws.body.thread.id}/messages`)
      .send({ content: "ws-question" })
      .expect(201);
    await waitForRunner();
    await request(app)
      .post(`/api/chat/threads/${proj.body.thread.id}/messages`)
      .send({ content: "proj-question" })
      .expect(201);
    await waitForRunner();

    expect(runnerCalls).toHaveLength(2);
    expect(runnerCalls[0].thread.workingDirectory).toBe("/tmp/wkspc");
    expect(runnerCalls[0].thread.model).toBe("claude-opus-4-7");
    expect(runnerCalls[1].thread.workingDirectory).toBe("/tmp/proj-x");
  });

  it("rejects a second concurrent turn with 409", async () => {
    let resolveRun!: () => void;
    runnerImpl = (input) =>
      new Promise<ChatTurnResult>((resolve) => {
        input.onEvent({ kind: "delta", text: "..." });
        resolveRun = () => resolve({ status: "completed", finalText: "..." });
      });

    const created = await request(app).post("/api/chat/threads").send({}).expect(201);
    const id = created.body.thread.id;
    await request(app)
      .post(`/api/chat/threads/${id}/messages`)
      .send({ content: "first" })
      .expect(201);
    const second = await request(app)
      .post(`/api/chat/threads/${id}/messages`)
      .send({ content: "second" });
    expect(second.status).toBe(409);
    resolveRun();
    await waitForRunner();
  });

  it("interrupt aborts the in-flight turn and marks the assistant message", async () => {
    runnerImpl = async (input) => {
      input.onEvent({ kind: "delta", text: "partial" });
      await new Promise<void>((resolve, reject) => {
        if (input.signal.aborted) return resolve();
        input.signal.addEventListener("abort", () => resolve(), { once: true });
        // Safety timeout in case the test doesn't abort.
        setTimeout(() => reject(new Error("never aborted")), 500).unref?.();
      });
      return { status: "cancelled", finalText: "partial" };
    };

    const created = await request(app).post("/api/chat/threads").send({}).expect(201);
    const id = created.body.thread.id;
    await request(app)
      .post(`/api/chat/threads/${id}/messages`)
      .send({ content: "long-running" })
      .expect(201);
    await request(app).post(`/api/chat/threads/${id}/interrupt`).expect(200);

    const detail = await request(app).get(`/api/chat/threads/${id}`).expect(200);
    const assistant = detail.body.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.content).toMatch(/interrupted/);
  });
});

describe("PATCH/DELETE thread", () => {
  it("renames + switches model/effort/scope", async () => {
    const created = await request(app).post("/api/chat/threads").send({}).expect(201);
    const r = await request(app)
      .patch(`/api/chat/threads/${created.body.thread.id}`)
      .send({ title: "renamed", model: "claude-opus-4-7", reasoningEffort: "high" })
      .expect(200);
    expect(r.body.thread).toMatchObject({
      title: "renamed",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
    });
  });

  it("delete cascades messages and nulls notes.chat_message_id", async () => {
    const created = await request(app).post("/api/chat/threads").send({}).expect(201);
    const id = created.body.thread.id;
    await request(app)
      .post(`/api/chat/threads/${id}/messages`)
      .send({ content: "hi" })
      .expect(201);
    await waitForRunner();
    const detail = await request(app).get(`/api/chat/threads/${id}`).expect(200);
    const assistantId = detail.body.messages[1].id;

    // Insert a note pointing at the assistant message.
    db.prepare(
      "INSERT INTO notes (id, source, title, body, chat_message_id) VALUES (?, ?, ?, ?, ?)",
    ).run("note-1", "chat_response", "saved", "hello", assistantId);

    await request(app).delete(`/api/chat/threads/${id}`).expect(200);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = ?").get(id) as {
        n: number;
      }).n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT chat_message_id FROM notes WHERE id = ?").get("note-1") as {
        chat_message_id: string | null;
      }).chat_message_id,
    ).toBeNull();
  });
});
