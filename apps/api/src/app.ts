import cors from "cors";
import express from "express";
import { createAgentRunSchema, runtimeSettingsSchema } from "@agent-dock/shared";
import type { AppContainer } from "./buildContainer.js";
import { streamRunEvents } from "./sse.js";
import { createWorkspaceRouter } from "./routes/workspace.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createAtlassianRouter } from "./routes/atlassian.js";
import { createMetaContextsRouter } from "./routes/metaContexts.js";
import { createExplorationRouter } from "./routes/exploration.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createNotesRouter } from "./routes/notes.js";
import { createStickyNotesRouter } from "./routes/stickyNotes.js";
import { createTodoListsRouter } from "./routes/todoLists.js";
import { createChatRouter } from "./routes/chat.js";

export function createApp(deps: AppContainer): express.Express {
  const { repos, runCoordinator, workspace, atlassian, exploration, tasks, startup, dashboard, sessionsService, notes, chat, workflows } = deps;
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "agent-dock-api", time: new Date().toISOString() });
  });

  app.get("/api/maintenance/report", async (_req, res, next) => {
    try {
      res.json({ report: await startup.reconcile() });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/settings/runtime", (_req, res) => {
    res.json({ settings: repos.settings.getRuntime() });
  });

  app.put("/api/settings/runtime", (req, res) => {
    const settings = repos.settings.setRuntime(runtimeSettingsSchema.parse(req.body));
    res.json({ settings });
  });

  app.use("/api/workspace", createWorkspaceRouter(workspace));
  app.use("/api/projects", createProjectsRouter({ projects: repos.projects, workspace }));
  app.use(
    "/api/atlassian",
    createAtlassianRouter({ service: atlassian, cache: repos.atlassianCache }),
  );
  app.use("/api/meta-contexts", createMetaContextsRouter(repos.metaContexts));
  app.use(
    "/api/exploration",
    createExplorationRouter({ coordinator: exploration, projects: repos.projects }),
  );
  app.use(
    "/api/tasks",
    createTasksRouter({ service: tasks, workflowCoordinator: workflows.coordinator }),
  );
  app.use("/api/dashboard", createDashboardRouter({ service: dashboard }));
  app.use("/api/notes", createNotesRouter({ service: notes }));
  app.use("/api/sticky-notes", createStickyNotesRouter({ service: notes }));
  app.use("/api/todo-lists", createTodoListsRouter({ service: notes }));
  app.use("/api/chat", createChatRouter({ service: chat }));
  app.use(
    "/api/sessions",
    createSessionsRouter({
      coordinator: workflows.coordinator,
      eventBus: workflows.eventBus,
      service: sessionsService,
      repos: {
        sessions: repos.sessions,
        workflowRuns: repos.workflowRuns,
        pipelineSteps: repos.pipelineSteps,
        stepEvents: repos.stepEvents,
        stepArtifacts: repos.stepArtifacts,
      },
    }),
  );

  app.get("/api/runs", (_req, res) => {
    res.json({ runs: repos.runs.list() });
  });

  app.post("/api/runs", (req, res) => {
    const run = runCoordinator.create(createAgentRunSchema.parse(req.body));
    res.status(201).json({ run });
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = repos.runs.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({
      run,
      events: repos.events.listForRun(run.id),
      artifacts: repos.artifacts.listForRun(run.id),
    });
  });

  app.get("/api/runs/:id/events", (req, res) => {
    const run = repos.runs.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    streamRunEvents(runCoordinator, repos.events, run.id, Number(req.query.after ?? 0), res);
  });

  app.post("/api/runs/:id/cancel", async (req, res, next) => {
    try {
      res.json({ run: await runCoordinator.cancel(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
        ? ((err as { status: number }).status)
        : 400;
    const body: Record<string, unknown> = { error: message };
    // Forward typed extras (Phase 37: approve's `gaps` array) when an
    // error object carries them, so the UI can render them inline.
    if (err && typeof err === "object" && "gaps" in err) {
      const gaps = (err as { gaps: unknown }).gaps;
      if (Array.isArray(gaps)) body.gaps = gaps;
    }
    res.status(status).json(body);
  });

  return app;
}
