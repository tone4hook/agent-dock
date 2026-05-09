import { Router } from "express";
import {
  appendChatMessageInputSchema,
  createChatThreadInputSchema,
  updateChatThreadInputSchema,
} from "@agent-dock/shared";
import type { ChatBusEvent, ChatService } from "../services/chat.js";

export interface ChatRouterDeps {
  service: ChatService;
}

export function createChatRouter({ service }: ChatRouterDeps): Router {
  const router = Router();

  router.get("/threads", (_req, res) => {
    res.json({ threads: service.listThreads() });
  });

  router.post("/threads", (req, res, next) => {
    try {
      const thread = service.createThread(createChatThreadInputSchema.parse(req.body));
      res.status(201).json({ thread });
    } catch (err) {
      next(err);
    }
  });

  router.get("/threads/:id", (req, res) => {
    const thread = service.getThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: "Chat thread not found" });
      return;
    }
    res.json({ thread, messages: service.listMessages(thread.id) });
  });

  router.patch("/threads/:id", (req, res, next) => {
    try {
      const thread = service.updateThread(
        req.params.id,
        updateChatThreadInputSchema.parse(req.body),
      );
      res.json({ thread });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/threads/:id", async (req, res, next) => {
    try {
      await service.deleteThread(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/threads/:id/messages", (req, res, next) => {
    try {
      const { content } = appendChatMessageInputSchema.parse(req.body);
      const result = service.appendUserMessage(req.params.id, content);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/threads/:id/interrupt", async (req, res, next) => {
    try {
      await service.interrupt(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/threads/:id/events", (req, res) => {
    const sub = service.subscribe(req.params.id, (event) => writeEvent(res, event));
    if (!sub) {
      res.status(404).json({ error: "Chat thread not found" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    for (const event of sub.replay) writeEvent(res, event);
    res.on("close", () => {
      sub.unsubscribe();
      res.end();
    });
  });

  return router;
}

function writeEvent(res: import("express").Response, event: ChatBusEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.kind}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
