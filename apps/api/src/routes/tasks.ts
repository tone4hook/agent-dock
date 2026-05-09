import { Router } from "express";
import { z } from "zod";
import {
  createTaskInputSchema,
  taskStatusValues,
  updateTaskInputSchema,
} from "@agent-dock/shared";
import type { WorkflowCoordinator } from "@agent-dock/orchestrator";
import type { TasksService } from "../services/tasks.js";

const linkSchema = z.object({
  role: z.string().default(""),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(taskStatusValues).optional(),
});

export interface TasksRouterDeps {
  service: TasksService;
  workflowCoordinator: WorkflowCoordinator;
}

const startSessionSchema = z.object({
  baseRefOverride: z.string().nullable().optional(),
});

export function createTasksRouter(deps: TasksRouterDeps): Router {
  const { service: svc, workflowCoordinator } = deps;
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const q = listQuerySchema.parse(req.query);
      res.json({ tasks: svc.list(q) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", (req, res) => {
    const task = svc.get(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ task });
  });

  router.post("/", (req, res, next) => {
    try {
      const input = createTaskInputSchema.parse(req.body);
      res.status(201).json({ task: svc.create(input) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const patch = updateTaskInputSchema.parse(req.body);
      res.json({ task: svc.update(req.params.id, patch) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await svc.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // --- Atlassian links ---

  router.post("/:id/jira-links/:key", (req, res, next) => {
    try {
      const { role } = linkSchema.parse(req.body);
      res.json({ task: svc.addJiraLink(req.params.id, req.params.key, role) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/jira-links/:key", (req, res) => {
    res.json({ task: svc.removeJiraLink(req.params.id, req.params.key) });
  });

  router.post("/:id/confluence-links/:pageId", (req, res, next) => {
    try {
      const { role } = linkSchema.parse(req.body);
      res.json({
        task: svc.addConfluenceLink(req.params.id, req.params.pageId, role),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/confluence-links/:pageId", (req, res) => {
    res.json({ task: svc.removeConfluenceLink(req.params.id, req.params.pageId) });
  });

  // --- Sessions ---

  router.get("/:id/sessions", (req, res, next) => {
    try {
      if (!svc.get(req.params.id)) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json({ sessions: svc.listSessionsForTask(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/sessions", async (req, res, next) => {
    try {
      const input = startSessionSchema.parse(req.body ?? {});
      const result = await workflowCoordinator.start(req.params.id, {
        baseRefOverride: input.baseRefOverride ?? null,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
