import { Router } from "express";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  PipelineStepsRepo,
  SessionsRepo,
  StepArtifactsRepo,
  StepEventsRepo,
  WorkflowRunsRepo,
} from "@agent-dock/db";
import { sessionStatusValues } from "@agent-dock/shared";
import type { EventBus, WorkflowCoordinator } from "@agent-dock/orchestrator";
import type { SessionsService } from "../services/sessions.js";

// Hard cap on artifact content served to the UI. Plan/findings markdown
// is small in practice; a 2 MiB ceiling keeps a malformed/runaway file
// from blowing the renderer.
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const clarifySchema = z.object({
  answers: z.record(z.string(), z.string().min(1)),
});

const rejectSchema = z.object({
  comment: z.string().min(1),
});

export interface SessionsRouterDeps {
  coordinator: WorkflowCoordinator;
  eventBus: EventBus;
  service: SessionsService;
  repos: {
    sessions: SessionsRepo;
    workflowRuns: WorkflowRunsRepo;
    pipelineSteps: PipelineStepsRepo;
    stepEvents: StepEventsRepo;
    stepArtifacts: StepArtifactsRepo;
  };
}

const listQuerySchema = z.object({
  status: z.enum(sessionStatusValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function createSessionsRouter(deps: SessionsRouterDeps): Router {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const q = listQuerySchema.parse(req.query);
      res.json(deps.service.list(q));
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", (req, res) => {
    const session = deps.repos.sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const runs = deps.repos.workflowRuns.listForSession(session.id);
    const steps = runs.flatMap((r) => deps.repos.pipelineSteps.listForRun(r.id));
    const artifacts = steps.flatMap((s) => deps.repos.stepArtifacts.listForStep(s.id));

    // Phase 34: surface a structured failure summary so the UI can
    // render SessionFailedCard without parsing step_events on the
    // client. Inspect the latest pipeline_step with status='failed' and
    // pull the most recent step_status event whose payload carries an
    // error string.
    let failureInfo: { role: string; errorMessage: string | null; stepId: string } | null = null;
    if (session.status === "failed") {
      const failed = [...steps]
        .filter((s) => s.status === "failed")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (failed) {
        const events = deps.repos.stepEvents.listForStep(failed.id);
        let errorMessage: string | null = null;
        for (const ev of events) {
          if (ev.kind !== "step_status") continue;
          const parsed = safeParse(ev.payloadJson) as { error?: unknown } | null;
          if (parsed && typeof parsed.error === "string" && parsed.error.length > 0) {
            errorMessage = parsed.error;
          }
        }
        failureInfo = { role: failed.role, errorMessage, stepId: failed.id };
      }
    }

    res.json({ session, runs, steps, artifacts, failureInfo });
  });

  router.post("/:id/pause", async (req, res, next) => {
    try {
      await deps.coordinator.pause(req.params.id);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/resume", async (req, res, next) => {
    try {
      await deps.coordinator.resume(req.params.id);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", async (req, res, next) => {
    try {
      await deps.coordinator.cancel(req.params.id);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/approve", async (req, res, next) => {
    try {
      await deps.coordinator.approve(req.params.id);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reject", async (req, res, next) => {
    try {
      const { comment } = rejectSchema.parse(req.body);
      await deps.coordinator.reject(req.params.id, comment);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/clarify", async (req, res, next) => {
    try {
      const { answers } = clarifySchema.parse(req.body);
      await deps.coordinator.submitClarificationAnswers(req.params.id, answers);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/retry-step", async (req, res, next) => {
    try {
      await deps.coordinator.retryStep(req.params.id);
      res.json({ session: deps.repos.sessions.get(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/artifacts/:artifactId/content", (req, res, next) => {
    try {
      const session = deps.repos.sessions.get(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      // Walk the session's runs/steps to find the artifact. Cheaper than
      // a wide repo query and keeps the artifact:session linkage explicit.
      const runs = deps.repos.workflowRuns.listForSession(session.id);
      let match: { filePath: string; kind: string } | null = null;
      outer: for (const run of runs) {
        for (const step of deps.repos.pipelineSteps.listForRun(run.id)) {
          for (const a of deps.repos.stepArtifacts.listForStep(step.id)) {
            if (a.id === req.params.artifactId) {
              match = { filePath: a.filePath, kind: a.kind };
              break outer;
            }
          }
        }
      }
      if (!match) {
        res.status(404).json({ error: "Artifact not found for this session" });
        return;
      }
      // Path safety: artifact paths are stored absolute; require that the
      // resolved path live under the session's worktree before reading.
      const worktreeRoot = resolve(session.worktreePath);
      const target = resolve(match.filePath);
      if (target !== worktreeRoot && !target.startsWith(worktreeRoot + "/")) {
        res.status(400).json({ error: "Artifact path is outside the session worktree" });
        return;
      }
      const stat = statSync(target);
      if (stat.size > MAX_ARTIFACT_BYTES) {
        res.status(413).json({
          error: `Artifact is ${stat.size} bytes; limit is ${MAX_ARTIFACT_BYTES}`,
        });
        return;
      }
      const content = readFileSync(target, "utf8");
      res.json({ content, kind: match.kind, bytes: stat.size });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/events", (req, res) => {
    const session = deps.repos.sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Replay persisted step_events first so a late subscriber catches up.
    const runs = deps.repos.workflowRuns.listForSession(session.id);
    for (const run of runs) {
      for (const step of deps.repos.pipelineSteps.listForRun(run.id)) {
        for (const event of deps.repos.stepEvents.listForStep(step.id)) {
          res.write(`event: ${event.kind}\n`);
          res.write(
            `data: ${JSON.stringify({ stepId: event.stepId, payload: safeParse(event.payloadJson), createdAt: event.createdAt })}\n\n`,
          );
        }
      }
    }

    const unsubscribe = deps.eventBus.subscribe(session.id, (event) => {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.kind}\n`);
      res.write(
        `data: ${JSON.stringify({ stepId: event.stepId, payload: event.payload, createdAt: event.createdAt })}\n\n`,
      );
    });

    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });

  return router;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
