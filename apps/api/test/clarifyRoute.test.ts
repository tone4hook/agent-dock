import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const clarifySchema = z.object({
  answers: z.record(z.string(), z.string().min(1)),
});

interface MockSession {
  id: string;
  status: string;
  taskId: string;
}

class MockCoordinator {
  /** Records of arguments passed; tests inspect to verify routing. */
  calls: Array<{ id: string; answers: Record<string, string> }> = [];
  /** Optional error to throw on next call; cleared after firing. */
  nextError: (Error & { status?: number; code?: string }) | null = null;

  async submitClarificationAnswers(
    id: string,
    answers: Record<string, string>,
  ): Promise<void> {
    this.calls.push({ id, answers });
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
  session = { id: "s1", status: "awaiting_clarification", taskId: "t1" };

  app = express();
  app.use(express.json({ limit: "1mb" }));

  // Single-purpose router that mirrors the production
  // POST /api/sessions/:id/clarify shape (apps/api/src/routes/sessions.ts).
  app.post("/api/sessions/:id/clarify", async (req, res, next) => {
    try {
      const { answers } = clarifySchema.parse(req.body);
      await coordinator.submitClarificationAnswers(req.params.id, answers);
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

describe("POST /api/sessions/:id/clarify", () => {
  it("happy path: forwards answers to coordinator and returns refreshed session", async () => {
    const res = await request(app)
      .post("/api/sessions/s1/clarify")
      .send({ answers: { q1: "32px", q2: "tile padding" } });

    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe("s1");
    expect(coordinator.calls).toEqual([
      { id: "s1", answers: { q1: "32px", q2: "tile padding" } },
    ]);
  });

  it("missing-answer body schema rejection: empty string answer → 400", async () => {
    const res = await request(app)
      .post("/api/sessions/s1/clarify")
      .send({ answers: { q1: "" } });

    expect(res.status).toBe(400);
    // The Zod-level rejection happens before the coordinator is called.
    expect(coordinator.calls).toHaveLength(0);
  });

  it("missing-answer coordinator-level rejection: 400 surfaces the missing question", async () => {
    coordinator.nextError = Object.assign(
      new Error("Missing answer for question q2: \"What padding?\""),
      { status: 400, code: "missing_answer" },
    );

    const res = await request(app)
      .post("/api/sessions/s1/clarify")
      .send({ answers: { q1: "32px" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("q2");
    expect(coordinator.calls).toHaveLength(1);
  });

  it("wrong-status coordinator-level rejection: 409 propagates via err.status", async () => {
    coordinator.nextError = Object.assign(
      new Error("Session is running, not awaiting_clarification"),
      { status: 409 },
    );

    const res = await request(app)
      .post("/api/sessions/s1/clarify")
      .send({ answers: { q1: "32px" } });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("not awaiting_clarification");
  });

  it("missing answers field on body: 400", async () => {
    const res = await request(app).post("/api/sessions/s1/clarify").send({});
    expect(res.status).toBe(400);
    expect(coordinator.calls).toHaveLength(0);
  });
});
