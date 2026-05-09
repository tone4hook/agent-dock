import { Router } from "express";
import { z } from "zod";
import type { AtlassianCacheRepo } from "@agent-dock/db";
import {
  composeSearchCql,
  composeSearchJql,
  type ConfluenceSearchChip,
  type SearchChip,
} from "@agent-dock/atlassian";
import type { AtlassianService } from "../services/atlassian.js";

const credsSchema = z.object({
  siteUrl: z.string().min(1).regex(/^https?:\/\//, "siteUrl must start with http(s)://"),
  email: z.string().min(1).regex(/.+@.+\..+/, "email must look like an email"),
  apiToken: z.string().min(1),
  boardId: z
    .string()
    .regex(/^\d+$/, "boardId must be digits only")
    .optional()
    .nullable(),
});

const searchQuerySchema = z.object({
  jql: z.string().optional(),
  cql: z.string().optional(),
  q: z.string().optional(),
  filters: z.string().optional(), // JSON-encoded SearchChip[]
  startAt: z.coerce.number().int().min(0).optional(),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
  nextPageToken: z.string().optional(),
});

const chipSchema = z.object({
  kind: z.enum(["project", "status", "assignee", "updated", "type"]),
  value: z.string(),
});

const confluenceChipSchema = z.object({
  kind: z.enum(["space", "author", "updated", "label"]),
  value: z.string(),
});

function parseFilters(raw: string | undefined): SearchChip[] {
  if (!raw) return [];
  try {
    const arr = z.array(chipSchema).parse(JSON.parse(raw));
    return arr;
  } catch {
    return [];
  }
}

function parseConfluenceFilters(raw: string | undefined): ConfluenceSearchChip[] {
  if (!raw) return [];
  try {
    return z.array(confluenceChipSchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export interface AtlassianRouterDeps {
  service: AtlassianService;
  cache: AtlassianCacheRepo;
}

export function createAtlassianRouter(deps: AtlassianRouterDeps): Router {
  const { service: svc, cache } = deps;
  const router = Router();

  // --- Credentials ---

  router.get("/status", async (_req, res, next) => {
    try {
      res.json(await svc.status());
    } catch (err) {
      next(err);
    }
  });

  router.put("/creds", async (req, res, next) => {
    try {
      const creds = credsSchema.parse(req.body);
      res.json(await svc.saveCreds(creds));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/creds", async (_req, res, next) => {
    try {
      res.json(await svc.clearCreds());
    } catch (err) {
      next(err);
    }
  });

  // --- Jira ---

  /**
   * Plain-English search backed by chip filters. The on-device chip→JQL
   * composer is `composeSearchJql`. Three call shapes:
   *   - `?jql=...` (advanced escape hatch — UI's "Advanced (JQL)" panel)
   *   - `?q=...&filters=<json>` (chip-driven; project comes from the board)
   *   - `?q=...` (chip-less free text scoped to the board's project)
   */
  router.get("/jira/search", async (req, res, next) => {
    try {
      const q = searchQuerySchema.parse(req.query);
      const jira = await svc.getJira();
      let jql: string;
      if (q.jql) {
        jql = q.jql;
      } else {
        const projectKey = await svc.getProjectKey();
        jql = composeSearchJql({
          q: q.q,
          projectKey,
          filters: parseFilters(q.filters),
        });
      }
      res.json(
        await jira.search(jql, {
          nextPageToken: q.nextPageToken,
          maxResults: q.maxResults,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/jira/my-issues", async (req, res, next) => {
    try {
      const q = searchQuerySchema.parse(req.query);
      const jira = await svc.getJira();
      res.json(
        await jira.myOpenIssues({
          nextPageToken: q.nextPageToken,
          maxResults: q.maxResults,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/jira/sprint", async (_req, res, next) => {
    try {
      const boardId = await svc.getBoardId();
      const jira = await svc.getJira();
      const sprint = await jira.getActiveSprint(boardId);
      if (!sprint) {
        res.json({ sprint: null, issues: [] });
        return;
      }
      const issues = await jira.getSprintIssues(sprint.id);
      res.json({ sprint, issues });
    } catch (err) {
      next(err);
    }
  });

  router.get("/jira/issues/:key", async (req, res, next) => {
    try {
      const jira = await svc.getJira();
      const [detail, comments] = await Promise.all([
        jira.getIssue(req.params.key),
        jira.getIssueComments(req.params.key),
      ]);
      const saved = cache.getJiraIssue(req.params.key) !== null;
      res.json({ ...detail, comments, saved });
    } catch (err) {
      next(err);
    }
  });

  router.get("/jira/saved", (_req, res) => {
    res.json({ keys: cache.listJiraIssues().map((r) => r.issueKey) });
  });

  router.post("/jira/issues/:key/save", async (req, res, next) => {
    try {
      const jira = await svc.getJira();
      const [detail, comments] = await Promise.all([
        jira.getIssue(req.params.key),
        jira.getIssueComments(req.params.key),
      ]);
      cache.upsertJiraIssue(req.params.key, { detail, comments });
      res.json({ saved: true, key: req.params.key });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/jira/issues/:key/save", (req, res) => {
    cache.deleteJiraIssue(req.params.key);
    res.json({ saved: false, key: req.params.key });
  });

  // --- Confluence ---

  /**
   * Plain-English Confluence search backed by chip filters. Three call
   * shapes:
   *   - `?cql=...` (advanced escape hatch — UI's "Advanced (CQL)" panel)
   *   - `?q=...&filters=<json>` (chip-driven)
   *   - `?q=...` (free text scoped to type=page)
   */
  router.get("/confluence/search", async (req, res, next) => {
    try {
      const q = searchQuerySchema.parse(req.query);
      const cql = q.cql
        ? q.cql
        : composeSearchCql({
            q: q.q,
            filters: parseConfluenceFilters(q.filters),
          });
      const confluence = await svc.getConfluence();
      res.json(
        await confluence.searchPages(cql, {
          start: q.startAt,
          limit: q.maxResults,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/confluence/pages/:id", async (req, res, next) => {
    try {
      const confluence = await svc.getConfluence();
      const detail = await confluence.getPage(req.params.id);
      const saved = cache.getConfluencePage(req.params.id) !== null;
      res.json({ ...detail, saved });
    } catch (err) {
      next(err);
    }
  });

  router.get("/confluence/saved", (_req, res) => {
    const pages = cache.listConfluencePages().map((row) => {
      const detail = parseConfluenceDetail(row.payloadJson);
      return {
        id: row.pageId,
        title: detail?.title ?? "",
        updatedAt: row.updatedAt,
      };
    });
    res.json({ pages });
  });

  router.post("/confluence/pages/:id/save", async (req, res, next) => {
    try {
      const confluence = await svc.getConfluence();
      const detail = await confluence.getPage(req.params.id);
      cache.upsertConfluencePage(req.params.id, { detail });
      res.json({ saved: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/confluence/pages/:id/save", (req, res) => {
    cache.deleteConfluencePage(req.params.id);
    res.json({ saved: false, id: req.params.id });
  });

  return router;
}

function parseConfluenceDetail(payloadJson: string): { title?: string } | null {
  try {
    const parsed = JSON.parse(payloadJson) as { detail?: { title?: string } };
    return parsed?.detail ?? null;
  } catch {
    return null;
  }
}
