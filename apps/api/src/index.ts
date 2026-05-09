import { createApp } from "./app.js";
import { buildContainer } from "./buildContainer.js";
import { registerShutdown } from "./shutdownManager.js";

const port = Number(process.env.AGENT_DOCK_API_PORT ?? 8792);

const container = buildContainer();
const app = createApp(container);

// Mark stale running/paused sessions as failed and surface any worktree
// orphans before accepting requests. Runs in the background so a slow
// `git worktree list` doesn't delay listen().
void container.startup.reconcile().catch((err) => {
  console.error("startup reconcile failed", err);
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Agent*Dock API listening on http://127.0.0.1:${port}`);
});

registerShutdown({ server, runCoordinator: container.runCoordinator });
