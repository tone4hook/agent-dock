import { Router } from "express";
import type { DashboardService } from "../services/dashboard.js";

interface Deps {
  service: DashboardService;
}

export function createDashboardRouter({ service }: Deps): Router {
  const router = Router();

  router.get("/", (_req, res, next) => {
    try {
      res.json({ summary: service.summary() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
