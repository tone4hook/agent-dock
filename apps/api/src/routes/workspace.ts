import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import type { WorkspaceService } from "../services/workspace.js";

const setWorkspaceSchema = z.object({ workspaceDir: z.string().min(1) });

const execFileAsync = promisify(execFile);

export function createWorkspaceRouter(service: WorkspaceService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(service.getState());
  });

  router.put("/", (req, res, next) => {
    try {
      const { workspaceDir } = setWorkspaceSchema.parse(req.body);
      res.json(service.setWorkspaceDir(workspaceDir));
    } catch (err) {
      next(err);
    }
  });

  // Server-side folder picker (macOS only). Neutralino's
  // os.showFolderDialog hangs in our packaged shell-script-launched
  // .app, so we shell out to AppleScript's `choose folder` from the
  // API process — System Events hosts the dialog reliably.
  router.post("/pick-folder", async (_req, res, next) => {
    try {
      if (process.platform !== "darwin") {
        res.status(501).json({ error: "Folder picker only implemented on macOS" });
        return;
      }
      const script =
        'try\n  set f to choose folder with prompt "Pick your workspace"\n  return POSIX path of f\non error number -128\n  return ""\nend try';
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script]);
      const path = stdout.trim().replace(/\/$/, "");
      res.json({ path: path.length > 0 ? path : null });
    } catch (err) {
      next(err);
    }
  });

  router.post("/rescan", (_req, res, next) => {
    try {
      const state = service.getState();
      if (!state.workspaceDir) {
        res.status(400).json({ error: "No workspace dir set" });
        return;
      }
      service.discoverProjects(state.workspaceDir);
      res.json(service.getState());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
