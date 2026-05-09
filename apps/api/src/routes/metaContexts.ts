import { Router } from "express";
import {
  createMetaContextInputSchema,
  metaContextScopeValues,
  updateMetaContextInputSchema,
} from "@agent-dock/shared";
import { z } from "zod";
import type { MetaContextsRepo } from "@agent-dock/db";

const listQuerySchema = z.object({
  scope: z.enum(metaContextScopeValues),
  scopeId: z.string().min(1),
});

export function createMetaContextsRouter(repo: MetaContextsRepo): Router {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const { scope, scopeId } = listQuerySchema.parse(req.query);
      res.json({ items: repo.listForScope(scope, scopeId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const input = createMetaContextInputSchema.parse(req.body);
      res.status(201).json({
        item: repo.create({
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          kind: input.kind,
          bodyMd: input.bodyMd,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const { bodyMd } = updateMetaContextInputSchema.parse(req.body);
      res.json({ item: repo.update(req.params.id, bodyMd) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", (req, res) => {
    repo.delete(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
