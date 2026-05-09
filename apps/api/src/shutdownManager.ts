import type { Server } from "node:http";
import { shutdownSpawnedClis } from "@agent-dock/agents";
import type { RunCoordinator } from "./runCoordinator.js";

interface RegisterShutdownArgs {
  server: Server;
  runCoordinator: RunCoordinator;
}

export function registerShutdown({ server, runCoordinator }: RegisterShutdownArgs): void {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Agent*Dock API shutting down: ${reason}`);
    server.close();
    await Promise.race([
      Promise.allSettled([
        runCoordinator.shutdown(reason),
        shutdownSpawnedClis(reason),
      ]),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    process.exitCode = exitCode;
    process.exit();
  };

  process.once("SIGINT", () => void shutdown("SIGINT", 0));
  process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.once("SIGHUP", () => void shutdown("SIGHUP", 0));
  process.once("uncaughtException", (err) => {
    console.error(err);
    void shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", (err) => {
    console.error(err);
    void shutdown("unhandledRejection", 1);
  });
}
