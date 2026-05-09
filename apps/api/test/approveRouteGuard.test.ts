import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface MockSession {
  id: string;
  status: string;
}

class MockCoordinator {
  approveCalls: string[] = [];
  /** Error thrown on next approve(); cleared after firing. */
  nextError: (Error & { status?: number; gaps?: string[] }) | null = null;

  async approve(id: string): Promise<void> {
    this.approveCalls.push(id);
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

  // Mirrors the production POST /api/sessions/:id/approve shape
  // (apps/api/src/routes/sessions.ts) and the global error mw in app.ts.
  app.post("/api/sessions/:id/approve", async (req, res, next) => {
    try {
      await coordinator.approve(req.params.id);
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

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
      const body: Record<string, unknown> = { error: message };
      if (err && typeof err === "object" && "gaps" in err) {
        const gaps = (err as { gaps: unknown }).gaps;
        if (Array.isArray(gaps)) body.gaps = gaps;
      }
      res.status(status).json(body);
    },
  );
});

afterEach(() => {
  coordinator.approveCalls = [];
  coordinator.nextError = null;
});

describe("Phase 37 — POST /api/sessions/:id/approve schema guard", () => {
  it("happy path returns 200 with the refreshed session", async () => {
    const res = await request(app).post("/api/sessions/s1/approve").send({});
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe("s1");
    expect(coordinator.approveCalls).toEqual(["s1"]);
  });

  it("coordinator.approve rejecting with status=409 + gaps[] surfaces 409 + gaps in the body", async () => {
    const err = Object.assign(
      new Error("Plan failed schema validation; reject-with-prompt to fix gaps"),
      {
        status: 409,
        gaps: [
          "phases.0.done_when: done_when looks vague (starts with TBD/later/TODO/etc/...)",
          "acceptance_criterion AC2 is not covered by any phase's covers_acceptance",
        ],
      },
    );
    coordinator.nextError = err;

    const res = await request(app).post("/api/sessions/s1/approve").send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Plan failed schema validation/);
    expect(res.body.gaps).toEqual([
      "phases.0.done_when: done_when looks vague (starts with TBD/later/TODO/etc/...)",
      "acceptance_criterion AC2 is not covered by any phase's covers_acceptance",
    ]);
  });

  it("coordinator.approve rejecting with no status defaults to 400 and omits gaps when absent", async () => {
    coordinator.nextError = new Error("Session is failed, not awaiting_approval");
    const res = await request(app).post("/api/sessions/s1/approve").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Session is failed/);
    expect(res.body.gaps).toBeUndefined();
  });
});
