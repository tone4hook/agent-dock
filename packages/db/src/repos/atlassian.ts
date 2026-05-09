import type Database from "better-sqlite3";
import type {
  ConfluencePage,
  ConfluencePageContext,
  JiraIssue,
  JiraIssueContext,
} from "@agent-dock/shared";

interface JiraIssueRow {
  issue_key: string;
  payload_json: string;
  fetched_at: string;
  updated_at: string;
}

interface JiraIssueContextRow {
  issue_key: string;
  notes_md: string;
  updated_at: string;
}

interface ConfluencePageRow {
  page_id: string;
  payload_json: string;
  fetched_at: string;
  updated_at: string;
}

interface ConfluencePageContextRow {
  page_id: string;
  notes_md: string;
  updated_at: string;
}

export class AtlassianCacheRepo {
  constructor(private readonly db: Database.Database) {}

  // --- Jira ---

  upsertJiraIssue(issueKey: string, payload: unknown): JiraIssue {
    this.db
      .prepare(
        `INSERT INTO jira_issues (issue_key, payload_json)
         VALUES (?, ?)
         ON CONFLICT(issue_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(issueKey, JSON.stringify(payload));
    // Ensure context row exists.
    this.db
      .prepare(
        `INSERT INTO jira_issue_context (issue_key, notes_md) VALUES (?, '')
         ON CONFLICT(issue_key) DO NOTHING`,
      )
      .run(issueKey);
    const row = this.getJiraIssue(issueKey);
    if (!row) throw new Error("Failed to upsert jira issue");
    return row;
  }

  getJiraIssue(issueKey: string): JiraIssue | null {
    const row = this.db
      .prepare("SELECT * FROM jira_issues WHERE issue_key = ?")
      .get(issueKey) as JiraIssueRow | undefined;
    return row
      ? {
          issueKey: row.issue_key,
          payloadJson: row.payload_json,
          fetchedAt: row.fetched_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  listJiraIssues(): JiraIssue[] {
    return (
      this.db.prepare("SELECT * FROM jira_issues ORDER BY updated_at DESC").all() as JiraIssueRow[]
    ).map((r) => ({
      issueKey: r.issue_key,
      payloadJson: r.payload_json,
      fetchedAt: r.fetched_at,
      updatedAt: r.updated_at,
    }));
  }

  getJiraIssueContext(issueKey: string): JiraIssueContext | null {
    const row = this.db
      .prepare("SELECT * FROM jira_issue_context WHERE issue_key = ?")
      .get(issueKey) as JiraIssueContextRow | undefined;
    return row
      ? { issueKey: row.issue_key, notesMd: row.notes_md, updatedAt: row.updated_at }
      : null;
  }

  setJiraIssueContext(issueKey: string, notesMd: string): JiraIssueContext {
    this.db
      .prepare(
        `INSERT INTO jira_issue_context (issue_key, notes_md, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(issue_key) DO UPDATE SET
           notes_md = excluded.notes_md,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(issueKey, notesMd);
    const row = this.getJiraIssueContext(issueKey);
    if (!row) throw new Error("Failed to set jira issue context");
    return row;
  }

  deleteJiraIssue(issueKey: string): void {
    this.db.prepare("DELETE FROM jira_issues WHERE issue_key = ?").run(issueKey);
  }

  // --- Confluence ---

  upsertConfluencePage(pageId: string, payload: unknown): ConfluencePage {
    this.db
      .prepare(
        `INSERT INTO confluence_pages (page_id, payload_json)
         VALUES (?, ?)
         ON CONFLICT(page_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(pageId, JSON.stringify(payload));
    this.db
      .prepare(
        `INSERT INTO confluence_page_context (page_id, notes_md) VALUES (?, '')
         ON CONFLICT(page_id) DO NOTHING`,
      )
      .run(pageId);
    const row = this.getConfluencePage(pageId);
    if (!row) throw new Error("Failed to upsert confluence page");
    return row;
  }

  getConfluencePage(pageId: string): ConfluencePage | null {
    const row = this.db
      .prepare("SELECT * FROM confluence_pages WHERE page_id = ?")
      .get(pageId) as ConfluencePageRow | undefined;
    return row
      ? {
          pageId: row.page_id,
          payloadJson: row.payload_json,
          fetchedAt: row.fetched_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  listConfluencePages(): ConfluencePage[] {
    return (
      this.db
        .prepare("SELECT * FROM confluence_pages ORDER BY updated_at DESC")
        .all() as ConfluencePageRow[]
    ).map((r) => ({
      pageId: r.page_id,
      payloadJson: r.payload_json,
      fetchedAt: r.fetched_at,
      updatedAt: r.updated_at,
    }));
  }

  getConfluencePageContext(pageId: string): ConfluencePageContext | null {
    const row = this.db
      .prepare("SELECT * FROM confluence_page_context WHERE page_id = ?")
      .get(pageId) as ConfluencePageContextRow | undefined;
    return row
      ? { pageId: row.page_id, notesMd: row.notes_md, updatedAt: row.updated_at }
      : null;
  }

  setConfluencePageContext(pageId: string, notesMd: string): ConfluencePageContext {
    this.db
      .prepare(
        `INSERT INTO confluence_page_context (page_id, notes_md, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(page_id) DO UPDATE SET
           notes_md = excluded.notes_md,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(pageId, notesMd);
    const row = this.getConfluencePageContext(pageId);
    if (!row) throw new Error("Failed to set confluence page context");
    return row;
  }

  deleteConfluencePage(pageId: string): void {
    this.db.prepare("DELETE FROM confluence_pages WHERE page_id = ?").run(pageId);
  }
}
