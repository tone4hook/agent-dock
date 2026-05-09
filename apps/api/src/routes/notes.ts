import { Router } from "express";
import { z } from "zod";
import {
  createNoteFromChatMessageInputSchema,
  createNoteInputSchema,
  noteSourceValues,
  updateNoteInputSchema,
} from "@agent-dock/shared";
import type { NotesService } from "../services/notes.js";

const listQuerySchema = z.object({
  source: z.enum(noteSourceValues).optional(),
  projectId: z.string().optional(),
  q: z.string().optional(),
  tag: z.string().optional(),
});

const tagBodySchema = z.object({ tag: z.string().min(1) });

export interface NotesRouterDeps {
  service: NotesService;
}

export function createNotesRouter({ service }: NotesRouterDeps): Router {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const q = listQuerySchema.parse(req.query);
      res.json({ notes: service.list(q) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const note = service.create(createNoteInputSchema.parse(req.body));
      res.status(201).json({ note });
    } catch (err) {
      next(err);
    }
  });

  router.post("/from-chat-message", (req, res, next) => {
    try {
      const note = service.createFromChatMessage(
        createNoteFromChatMessageInputSchema.parse(req.body),
      );
      res.status(201).json({ note });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", (req, res) => {
    const note = service.get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json({ note });
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const note = service.update(req.params.id, updateNoteInputSchema.parse(req.body));
      res.json({ note });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", (req, res) => {
    service.delete(req.params.id);
    res.json({ ok: true });
  });

  // Link sub-routes
  router.post("/:id/jira-links/:key", (req, res, next) => {
    try {
      res.json({ note: service.addJiraLink(req.params.id, req.params.key) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:id/jira-links/:key", (req, res, next) => {
    try {
      res.json({ note: service.removeJiraLink(req.params.id, req.params.key) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/:id/confluence-links/:pageId", (req, res, next) => {
    try {
      res.json({ note: service.addConfluenceLink(req.params.id, req.params.pageId) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:id/confluence-links/:pageId", (req, res, next) => {
    try {
      res.json({ note: service.removeConfluenceLink(req.params.id, req.params.pageId) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/:id/task-links/:taskId", (req, res, next) => {
    try {
      res.json({ note: service.addTaskLink(req.params.id, req.params.taskId) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:id/task-links/:taskId", (req, res, next) => {
    try {
      res.json({ note: service.removeTaskLink(req.params.id, req.params.taskId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/tags", (req, res, next) => {
    try {
      const { tag } = tagBodySchema.parse(req.body);
      res.json({ note: service.addTag(req.params.id, tag) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:id/tags/:tag", (req, res, next) => {
    try {
      res.json({ note: service.removeTag(req.params.id, req.params.tag) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
