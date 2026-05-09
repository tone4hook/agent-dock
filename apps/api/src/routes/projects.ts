import { Router } from "express";
import { z } from "zod";
import type { ProjectsRepo } from "@agent-dock/db";
import type { WorkspaceService } from "../services/workspace.js";

const addProjectSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  defaultBaseRef: z.string().min(1).optional(),
  archived: z.boolean().optional(),
});

export function createProjectsRouter(deps: {
  projects: ProjectsRepo;
  workspace: WorkspaceService;
}): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    res.json({ projects: deps.projects.list({ includeArchived }) });
  });

  router.post("/", (req, res, next) => {
    try {
      const { rootPath, name } = addProjectSchema.parse(req.body);
      res.status(201).json({ project: deps.workspace.addProject(rootPath, name) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const patch = updateProjectSchema.parse(req.body);
      res.json({ project: deps.projects.update(req.params.id, patch) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
