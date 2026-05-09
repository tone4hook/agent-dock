import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AtlassianCacheRepo, migrate } from "@agent-dock/db";
import { createAtlassianRouter } from "../src/routes/atlassian.js";
import type { AtlassianService } from "../src/services/atlassian.js";

let db: Database.Database;
let app: express.Express;
let cache: AtlassianCacheRepo;

// The /confluence/saved route only touches `cache` — never `service`.
// A throwing stub catches accidental coupling: if a future change makes
// the saved route hit the service, the test will fail loudly.
const stubService = new Proxy({} as AtlassianService, {
  get() {
    throw new Error("AtlassianService should not be called by /confluence/saved");
  },
});

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  cache = new AtlassianCacheRepo(db);

  app = express();
  app.use(express.json());
  app.use("/api/atlassian", createAtlassianRouter({ service: stubService, cache }));
});

afterEach(() => {
  db.close();
});

describe("GET /api/atlassian/confluence/saved", () => {
  it("returns title + updatedAt parsed out of payloadJson.detail for each cached page", async () => {
    cache.upsertConfluencePage("page-1", {
      detail: { title: "Onboarding runbook", bodyMd: "..." },
    });
    cache.upsertConfluencePage("page-2", {
      detail: { title: "Module Federation Playbook", bodyMd: "..." },
    });

    const res = await request(app).get("/api/atlassian/confluence/saved");
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(2);
    const titlesById = new Map(
      (res.body.pages as Array<{ id: string; title: string; updatedAt: string }>).map((p) => [
        p.id,
        p.title,
      ]),
    );
    expect(titlesById.get("page-1")).toBe("Onboarding runbook");
    expect(titlesById.get("page-2")).toBe("Module Federation Playbook");
    for (const p of res.body.pages) {
      expect(typeof p.updatedAt).toBe("string");
      expect(p.updatedAt.length).toBeGreaterThan(0);
    }
  });

  it("falls back to title='' when payloadJson is malformed or detail.title is missing", async () => {
    cache.upsertConfluencePage("page-no-title", {
      detail: { bodyMd: "no title in detail" },
    });
    // Manually corrupt one row to malformed JSON via direct DB write.
    db.prepare("UPDATE confluence_pages SET payload_json = ? WHERE page_id = ?").run(
      "{not valid json",
      "page-no-title",
    );
    cache.upsertConfluencePage("page-empty-detail", {
      detail: { title: "", bodyMd: "explicit empty title" },
    });

    const res = await request(app).get("/api/atlassian/confluence/saved");
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.body.pages as Array<{ id: string; title: string }>).map((p) => [p.id, p.title]),
    );
    expect(byId.get("page-no-title")).toBe("");
    expect(byId.get("page-empty-detail")).toBe("");
  });

  it("returns {pages: []} when no pages are cached", async () => {
    const res = await request(app).get("/api/atlassian/confluence/saved");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pages: [] });
  });
});
