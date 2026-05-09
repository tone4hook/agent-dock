import { Router } from "express";
import {
  createStickyNoteInputSchema,
  updateStickyNoteInputSchema,
} from "@agent-dock/shared";
import type { NotesService } from "../services/notes.js";

export interface StickyNotesRouterDeps {
  service: NotesService;
}

export function createStickyNotesRouter({ service }: StickyNotesRouterDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ stickies: service.listStickies() });
  });

  router.post("/", (req, res, next) => {
    try {
      const sticky = service.createSticky(createStickyNoteInputSchema.parse(req.body));
      res.status(201).json({ sticky });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const sticky = service.updateSticky(
        req.params.id,
        updateStickyNoteInputSchema.parse(req.body),
      );
      res.json({ sticky });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", (req, res) => {
    service.deleteSticky(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
