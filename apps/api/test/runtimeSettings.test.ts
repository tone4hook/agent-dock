import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, SettingsRepo } from "@agent-dock/db";
import { runtimeSettingsSchema } from "@agent-dock/shared";

let db: Database.Database;
let app: express.Express;
let settings: SettingsRepo;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  settings = new SettingsRepo(db);

  app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/settings/runtime", (_req, res) => {
    res.json({ settings: settings.getRuntime() });
  });
  app.put("/api/settings/runtime", (req, res) => {
    res.json({ settings: settings.setRuntime(runtimeSettingsSchema.parse(req.body)) });
  });
});

afterEach(() => db?.close());

describe("GET /api/settings/runtime — welcomeDismissed default", () => {
  it("returns welcomeDismissed=false when nothing has been persisted yet", async () => {
    const res = await request(app).get("/api/settings/runtime");
    expect(res.status).toBe(200);
    expect(res.body.settings.welcomeDismissed).toBe(false);
  });
});

describe("PUT /api/settings/runtime — welcomeDismissed round-trip", () => {
  it("persists welcomeDismissed=true and reads it back", async () => {
    const initial = (await request(app).get("/api/settings/runtime")).body.settings;

    const put = await request(app)
      .put("/api/settings/runtime")
      .send({ ...initial, welcomeDismissed: true });

    expect(put.status).toBe(200);
    expect(put.body.settings.welcomeDismissed).toBe(true);

    const after = (await request(app).get("/api/settings/runtime")).body.settings;
    expect(after.welcomeDismissed).toBe(true);
  });

  it("flips back to false when explicitly set", async () => {
    const initial = (await request(app).get("/api/settings/runtime")).body.settings;
    await request(app)
      .put("/api/settings/runtime")
      .send({ ...initial, welcomeDismissed: true });

    const flipped = await request(app)
      .put("/api/settings/runtime")
      .send({ ...initial, welcomeDismissed: false });
    expect(flipped.body.settings.welcomeDismissed).toBe(false);
  });
});
