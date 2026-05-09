import { Router } from "express";
import {
  createTodoItemInputSchema,
  createTodoListInputSchema,
  updateTodoItemInputSchema,
  updateTodoListInputSchema,
} from "@agent-dock/shared";
import type { NotesService } from "../services/notes.js";

export interface TodoListsRouterDeps {
  service: NotesService;
}

export function createTodoListsRouter({ service }: TodoListsRouterDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ lists: service.listTodoLists() });
  });

  router.post("/", (req, res, next) => {
    try {
      const list = service.createTodoList(createTodoListInputSchema.parse(req.body));
      res.status(201).json({ list });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", (req, res) => {
    const list = service.getTodoList(req.params.id);
    if (!list) {
      res.status(404).json({ error: "ToDo list not found" });
      return;
    }
    res.json({ list });
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const list = service.updateTodoList(
        req.params.id,
        updateTodoListInputSchema.parse(req.body),
      );
      res.json({ list });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", (req, res) => {
    service.deleteTodoList(req.params.id);
    res.json({ ok: true });
  });

  // Items

  router.post("/:id/items", (req, res, next) => {
    try {
      const item = service.createTodoItem(
        req.params.id,
        createTodoItemInputSchema.parse(req.body),
      );
      res.status(201).json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/items/:itemId", (req, res, next) => {
    try {
      const item = service.updateTodoItem(
        req.params.itemId,
        updateTodoItemInputSchema.parse(req.body),
      );
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/items/:itemId", (req, res) => {
    service.deleteTodoItem(req.params.itemId);
    res.json({ ok: true });
  });

  return router;
}
