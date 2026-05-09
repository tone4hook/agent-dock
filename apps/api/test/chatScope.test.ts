import Database from "better-sqlite3";
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

let db: Database.Database;
let calls: RunChatTurnInput[];

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
    workspaceDir: "/tmp/wkspc-scope",
    maxConcurrentSessions: 3,
  });

  calls = [];
});

afterEach(() => db?.close());

function makeService() {
  const projects = new ProjectsRepo(db);
  return {
    projects,
    settings: new SettingsRepo(db),
    service: new ChatService({
      threads: new ChatThreadsRepo(db),
      messages: new ChatMessagesRepo(db),
      projects,
      workspaceDir: () => new SettingsRepo(db).getRuntime().workspaceDir,
      runChatTurn: async (input) => {
        calls.push(input);
        const result: ChatTurnResult = { status: "completed", finalText: "ok" };
        input.onEvent({ kind: "final", text: "ok" });
        return result;
      },
    }),
  };
}

describe("scope→workingDirectory", () => {
  it("general scope passes null", async () => {
    const { service } = makeService();
    const t = service.createThread({
      title: "g",
      model: "claude-sonnet-4-6",
      scope: "general",
    });
    service.appendUserMessage(t.id, "hi");
    await service.interrupt(t.id); // ensure run promise settles
    expect(calls[0].thread.workingDirectory).toBeNull();
  });

  it("workspace scope resolves the workspaceDir setting", async () => {
    const { service } = makeService();
    const t = service.createThread({
      title: "w",
      model: "claude-sonnet-4-6",
      scope: "workspace",
    });
    service.appendUserMessage(t.id, "hi");
    await service.interrupt(t.id);
    expect(calls[0].thread.workingDirectory).toBe("/tmp/wkspc-scope");
  });

  it("project scope resolves the project root", async () => {
    const { service, projects } = makeService();
    const p = projects.create({ rootPath: "/tmp/proj-z", name: "z" });
    const t = service.createThread({
      title: "p",
      model: "claude-sonnet-4-6",
      scope: "project",
      scopeProjectId: p.id,
    });
    service.appendUserMessage(t.id, "hi");
    await service.interrupt(t.id);
    expect(calls[0].thread.workingDirectory).toBe("/tmp/proj-z");
  });
});
