import { adfToMarkdown } from "./adf.js";
import { basicAuthHeader } from "./keychain.js";
import type {
  AtlassianCreds,
  JiraIssueComment,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraSearchResult,
  JiraSprintIssue,
  JiraSprintSummary,
} from "./types.js";

export interface JiraSearchOpts {
  nextPageToken?: string; // cursor from a prior response
  maxResults?: number; // server caps at 100; default 25
  fields?: string[];
}

export class JiraClient {
  constructor(private readonly creds: AtlassianCreds) {}

  /**
   * Uses the new GET /rest/api/3/search/jql endpoint (the legacy
   * /search returns 410 Gone as of 2025-05-01). Pagination is cursor-
   * based via `nextPageToken`; the response no longer carries a `total`.
   */
  async search(jql: string, opts: JiraSearchOpts = {}): Promise<JiraSearchResult> {
    const url = new URL(`${this.creds.siteUrl}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("maxResults", String(opts.maxResults ?? 25));
    const fields = opts.fields ?? ["summary", "status", "assignee", "updated"];
    url.searchParams.set("fields", fields.join(","));
    if (opts.nextPageToken) url.searchParams.set("nextPageToken", opts.nextPageToken);

    const json = (await this.request(url.toString())) as {
      issues?: Array<{
        key: string;
        fields: {
          summary?: string;
          status?: { name?: string };
          assignee?: { displayName?: string } | null;
          updated?: string;
        };
      }>;
      nextPageToken?: string | null;
      isLast?: boolean;
    };

    return {
      issues: (json.issues ?? []).map(toSummary),
      nextPageToken: json.nextPageToken ?? null,
      isLast: json.isLast ?? json.nextPageToken == null,
    };
  }

  /**
   * "My open issues" — assignee = current user, not done, newest first.
   * Wraps `search()` with the canonical JQL string.
   */
  async myOpenIssues(opts: JiraSearchOpts = {}): Promise<JiraSearchResult> {
    const jql = `assignee = "${escapeJqlValue(this.creds.email)}" AND statusCategory != Done ORDER BY updated DESC`;
    return this.search(jql, opts);
  }

  /**
   * Active sprint for an agile board. Returns null when the board has
   * no active sprint (Atlassian returns `values: []`).
   */
  async getActiveSprint(boardId: string): Promise<JiraSprintSummary | null> {
    const url = new URL(
      `${this.creds.siteUrl}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`,
    );
    url.searchParams.set("state", "active");
    const json = (await this.request(url.toString())) as {
      values?: Array<{ id: number; name: string; startDate?: string; endDate?: string }>;
    };
    const first = (json.values ?? [])[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.name,
      startDate: first.startDate ?? null,
      endDate: first.endDate ?? null,
    };
  }

  /**
   * All issues in a sprint (unpaged — Atlassian caps maxResults at 200,
   * which is fine for a single sprint).
   */
  async getSprintIssues(sprintId: number): Promise<JiraSprintIssue[]> {
    const url = new URL(
      `${this.creds.siteUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
    );
    url.searchParams.set(
      "fields",
      "summary,status,assignee,priority,updated,customfield_10016",
    );
    url.searchParams.set("maxResults", "200");
    const json = (await this.request(url.toString())) as {
      issues?: Array<{
        key: string;
        fields: Record<string, unknown> & {
          summary?: string;
          status?: { name?: string; statusCategory?: { key?: string } };
          assignee?: { displayName?: string } | null;
          priority?: { name?: string } | null;
          updated?: string;
        };
      }>;
    };
    return (json.issues ?? []).map(toSprintIssue);
  }

  /**
   * Resolve the project key for a board (used to scope chip-filter
   * search).
   */
  async getBoardProjectKey(boardId: string): Promise<string | null> {
    const url = `${this.creds.siteUrl}/rest/agile/1.0/board/${encodeURIComponent(boardId)}`;
    const json = (await this.request(url)) as {
      location?: { projectKey?: string };
    };
    return json.location?.projectKey ?? null;
  }

  async getIssue(key: string): Promise<JiraIssueDetail> {
    const url = `${this.creds.siteUrl}/rest/api/3/issue/${encodeURIComponent(key)}`;
    const json = (await this.request(url)) as {
      key: string;
      fields: {
        summary?: string;
        status?: { name?: string };
        assignee?: { displayName?: string } | null;
        reporter?: { displayName?: string } | null;
        updated?: string;
        description?: unknown; // ADF doc
      };
    };
    return {
      key: json.key,
      summary: json.fields.summary ?? "",
      status: json.fields.status?.name ?? "",
      assignee: json.fields.assignee?.displayName ?? null,
      reporter: json.fields.reporter?.displayName ?? null,
      updated: json.fields.updated ?? "",
      descriptionMd: adfToMarkdown(json.fields.description),
      raw: json,
    };
  }

  async getIssueComments(key: string): Promise<JiraIssueComment[]> {
    const url = `${this.creds.siteUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`;
    const json = (await this.request(url)) as {
      comments?: Array<{
        id: string;
        author?: { displayName?: string } | null;
        body?: unknown;
        created?: string;
      }>;
    };
    return (json.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author?.displayName ?? null,
      bodyMd: adfToMarkdown(c.body),
      createdAt: c.created ?? "",
    }));
  }

  private async request(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(this.creds),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira request failed: ${res.status} ${res.statusText} ${text}`);
    }
    return (await res.json()) as unknown;
  }
}

// ---------- Search-chip composition ----------

export type SearchChipKind = "project" | "status" | "assignee" | "updated" | "type";

export interface SearchChip {
  kind: SearchChipKind;
  value: string;
}

export interface ComposeSearchInput {
  /** Plain-English text the user typed; matched against summary + key. */
  q?: string;
  /** Optional project key to scope to — usually from the board. */
  projectKey?: string | null;
  /** Selected chip filters. Empty array → no chip clauses. */
  filters?: SearchChip[];
}

const STATUS_TOKEN: Record<string, string> = {
  open: "statusCategory = \"To Do\"",
  in_progress: "statusCategory = \"In Progress\"",
  done: "statusCategory = Done",
};

const UPDATED_TOKEN: Record<string, string> = {
  today: "updated >= startOfDay()",
  this_week: "updated >= startOfWeek()",
  this_month: "updated >= startOfMonth()",
  recent: "updated >= -7d",
};

/**
 * Deterministic on-device chip→JQL composition. The returned string is
 * suitable for `JiraClient.search(jql)`. The Search tab's Advanced (raw
 * JQL) escape hatch bypasses this and posts a JQL string directly.
 *
 * Quote escaping is Jira's standard `"` → `\"` rule. Project keys are
 * not quoted (they're identifiers), but assignee/text are.
 */
export function composeSearchJql(input: ComposeSearchInput): string {
  const clauses: string[] = [];
  const filters = input.filters ?? [];

  const projectFilter = filters.find((f) => f.kind === "project");
  const projectKey = projectFilter?.value || input.projectKey;
  if (projectKey) clauses.push(`project = ${escapeJqlValue(projectKey)}`);

  const q = (input.q ?? "").trim();
  if (q) {
    clauses.push(`(text ~ "${escapeJqlValue(q)}" OR key = "${escapeJqlValue(q)}")`);
  }

  for (const f of filters) {
    if (f.kind === "project") continue; // already handled
    if (!f.value) continue;
    if (f.kind === "status") {
      const tok = STATUS_TOKEN[f.value];
      if (tok) clauses.push(tok);
      else clauses.push(`status = "${escapeJqlValue(f.value)}"`);
    } else if (f.kind === "assignee") {
      if (f.value === "me" || f.value === "currentUser") {
        clauses.push("assignee = currentUser()");
      } else if (f.value === "unassigned") {
        clauses.push("assignee is EMPTY");
      } else {
        clauses.push(`assignee = "${escapeJqlValue(f.value)}"`);
      }
    } else if (f.kind === "updated") {
      const tok = UPDATED_TOKEN[f.value];
      if (tok) clauses.push(tok);
    } else if (f.kind === "type") {
      clauses.push(`issuetype = "${escapeJqlValue(f.value)}"`);
    }
  }

  const where = clauses.join(" AND ");
  return where ? `${where} ORDER BY updated DESC` : "ORDER BY updated DESC";
}

function escapeJqlValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toSummary(item: {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    updated?: string;
  };
}): JiraIssueSummary {
  return {
    key: item.key,
    summary: item.fields.summary ?? "",
    status: item.fields.status?.name ?? "",
    assignee: item.fields.assignee?.displayName ?? null,
    updated: item.fields.updated ?? "",
  };
}

function toSprintIssue(item: {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    priority?: { name?: string } | null;
    updated?: string;
  };
}): JiraSprintIssue {
  const cat = item.fields.status?.statusCategory?.key;
  const sp = (item.fields as Record<string, unknown>).customfield_10016;
  return {
    key: item.key,
    summary: item.fields.summary ?? "",
    status: item.fields.status?.name ?? "",
    assignee: item.fields.assignee?.displayName ?? null,
    updated: item.fields.updated ?? "",
    priority: item.fields.priority?.name ?? null,
    storyPoints: typeof sp === "number" ? sp : null,
    statusCategory:
      cat === "new" || cat === "undefined"
        ? "todo"
        : cat === "indeterminate"
          ? "indeterminate"
          : cat === "done"
            ? "done"
            : null,
  };
}
