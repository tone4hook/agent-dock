// Shapes are intentionally permissive — we keep the raw Atlassian payload
// in `payload_json` and surface only fields the UI actually reads. Anything
// downstream that needs richer typing should narrow at the call site.

export interface AtlassianCreds {
  siteUrl: string; // e.g. "https://your-co.atlassian.net" (no trailing slash)
  email: string;
  apiToken: string;
  /** Numeric Jira agile board id (e.g. "42"). Optional — required only for the Sprint tab. */
  boardId?: string | null;
}

export interface JiraSprintSummary {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

export interface JiraSprintIssue extends JiraIssueSummary {
  priority: string | null;
  storyPoints: number | null;
  statusCategory: "todo" | "indeterminate" | "done" | null;
}

export interface JiraSearchResult {
  issues: JiraIssueSummary[];
  nextPageToken: string | null; // null when there are no further pages
  isLast: boolean;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  updated: string;
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  reporter: string | null;
  updated: string;
  descriptionMd: string;
  raw: unknown; // full payload for cache row
}

export interface JiraIssueComment {
  id: string;
  author: string | null;
  bodyMd: string;
  createdAt: string;
}

export interface ConfluenceSearchResult {
  results: ConfluencePageSummary[];
  total: number;
}

export interface ConfluencePageSummary {
  id: string;
  title: string;
  spaceKey: string | null;
  updatedAt: string;
}

export interface ConfluencePageDetail {
  id: string;
  title: string;
  spaceKey: string | null;
  updatedAt: string;
  bodyMd: string;
  raw: unknown;
}

// --- ADF (Atlassian Document Format) shapes — minimal, see adf.ts ---

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

export interface AdfDoc extends AdfNode {
  type: "doc";
  version?: number;
}
