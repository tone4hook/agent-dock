import { Router } from "express";
import { z } from "zod";
import { existsSync } from "node:fs";
import { metaContextScopeValues } from "@agent-dock/shared";
import type { ExplorationCoordinator } from "../services/explorationCoordinator.js";
import type { ProjectsRepo } from "@agent-dock/db";

const startSchema = z.object({
  prompt: z.string().min(1),
  scopeType: z.enum(metaContextScopeValues),
  scopeId: z.string().min(1),
  projectId: z.string().min(1),
});

export function createExplorationRouter(deps: {
  coordinator: ExplorationCoordinator;
  projects: ProjectsRepo;
}): Router {
  const router = Router();

  router.post("/haiku", (req, res, next) => {
    try {
      const input = startSchema.parse(req.body);
      const project = deps.projects.get(input.projectId);
      if (!project) {
        res.status(404).json({ error: `Project ${input.projectId} not found` });
        return;
      }
      if (!existsSync(project.rootPath)) {
        res.status(400).json({ error: `Project root no longer exists: ${project.rootPath}` });
        return;
      }
      const snap = deps.coordinator.start({
        prompt: input.prompt,
        workingDirectory: project.rootPath,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });
      res.status(201).json(snap);
    } catch (err) {
      next(err);
    }
  });

  router.get("/haiku/:id", (req, res) => {
    const snap = deps.coordinator.get(req.params.id);
    if (!snap) {
      res.status(404).json({ error: "Exploration not found" });
      return;
    }
    res.json(snap);
  });

  router.post("/haiku/:id/cancel", (req, res) => {
    const snap = deps.coordinator.cancel(req.params.id);
    if (!snap) {
      res.status(404).json({ error: "Exploration not found" });
      return;
    }
    res.json(snap);
  });

  router.delete("/haiku/:id", (req, res) => {
    deps.coordinator.forget(req.params.id);
    res.json({ ok: true });
  });

  router.get("/haiku/:id/events", (req, res) => {
    const sub = deps.coordinator.subscribe(req.params.id, (event) => {
      writeEvent(res, event);
    });
    if (!sub) {
      res.status(404).json({ error: "Exploration not found" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    for (const event of sub.replay) writeEvent(res, event);
    res.on("close", () => {
      sub.unsubscribe();
      res.end();
    });
  });

  return router;
}

function writeEvent(res: import("express").Response, event: { id: number; kind: string; payload: unknown; createdAt: string }): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.kind}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
