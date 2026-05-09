import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface MockSession {
  id: string;
  status: string;
}

class MockCoordinator {
  calls: string[] = [];
  nextError: (Error & { status?: number }) | null = null;

  async retryStep(id: string): Promise<void> {
    this.calls.push(id);
    if (this.nextError) {
      const e = this.nextError;
      this.nextError = null;
      throw e;
    }
  }
}

let app: express.Express;
let coordinator: MockCoordinator;
let session: MockSession;

beforeEach(() => {
  coordinator = new MockCoordinator();
  session = { id: "s1", status: "running" };

  app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/api/sessions/:id/retry-step", async (req, res, next) => {
    try {
      await coordinator.retryStep(req.params.id);
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 400;
    res.status(status).json({ error: message });
  });
});

afterEach(() => {
  coordinator.calls = [];
});

describe("POST /api/sessions/:id/retry-step", () => {
  it("happy path: forwards to coordinator and returns refreshed session", async () => {
    const res = await request(app).post("/api/sessions/s1/retry-step").send({});
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe("s1");
    expect(coordinator.calls).toEqual(["s1"]);
  });

  it("session not in failed status: 409 propagates from err.status", async () => {
    coordinator.nextError = Object.assign(
      new Error("Session is awaiting_approval, not failed"),
      { status: 409 },
    );
    const res = await request(app).post("/api/sessions/s1/retry-step").send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("not failed");
  });

  it("no failed step found: 400 propagates from err.status", async () => {
    coordinator.nextError = Object.assign(
      new Error("No failed step to retry"),
      { status: 400 },
    );
    const res = await request(app).post("/api/sessions/s1/retry-step").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No failed step");
  });
});
