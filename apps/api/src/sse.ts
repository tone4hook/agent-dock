import type { Response } from "express";
import type { AgentRunEventsRepo } from "@agent-dock/db";
import type { AgentRunEventRecord } from "@agent-dock/shared";
import type { RunCoordinator } from "./runCoordinator.js";

export function streamRunEvents(
  coordinator: RunCoordinator,
  eventsRepo: AgentRunEventsRepo,
  runId: string,
  after: number,
  res: Response,
): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const event of eventsRepo.listForRun(runId, after)) {
    writeEvent(res, event);
  }

  const unsubscribe = coordinator.subscribe(runId, (event) => writeEvent(res, event));
  res.on("close", () => {
    unsubscribe();
    res.end();
  });
}

function writeEvent(res: Response, event: AgentRunEventRecord): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.eventType}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
