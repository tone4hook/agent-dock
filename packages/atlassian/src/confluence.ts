import { adfToMarkdown } from "./adf.js";
import { basicAuthHeader } from "./keychain.js";
import type {
  AtlassianCreds,
  ConfluencePageDetail,
  ConfluencePageSummary,
  ConfluenceSearchResult,
} from "./types.js";

export interface ConfluenceSearchOpts {
  start?: number;
  limit?: number;
}

export class ConfluenceClient {
  constructor(private readonly creds: AtlassianCreds) {}

  async searchPages(cql: string, opts: ConfluenceSearchOpts = {}): Promise<ConfluenceSearchResult> {
    // Confluence Cloud REST v1 search: /wiki/rest/api/content/search
    const url = new URL(`${this.creds.siteUrl}/wiki/rest/api/content/search`);
    url.searchParams.set("cql", cql);
    url.searchParams.set("start", String(opts.start ?? 0));
    url.searchParams.set("limit", String(opts.limit ?? 25));

    const json = (await this.request(url.toString())) as {
      results?: Array<{
        id: string;
        title?: string;
        space?: { key?: string } | null;
        version?: { when?: string };
      }>;
      size?: number;
      totalSize?: number;
    };
    const items: ConfluencePageSummary[] = (json.results ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? "",
      spaceKey: r.space?.key ?? null,
      updatedAt: r.version?.when ?? "",
    }));
    return {
      results: items,
      total: json.totalSize ?? json.size ?? items.length,
    };
  }

  async getPage(id: string): Promise<ConfluencePageDetail> {
    const url = new URL(`${this.creds.siteUrl}/wiki/api/v2/pages/${encodeURIComponent(id)}`);
    url.searchParams.set("body-format", "atlas_doc_format");
    const json = (await this.request(url.toString())) as {
      id?: string;
      title?: string;
      spaceId?: string | null;
      version?: { createdAt?: string };
      body?: { atlas_doc_format?: { value?: string } };
    };
    let bodyMd = "";
    const value = json.body?.atlas_doc_format?.value;
    if (typeof value === "string" && value.length > 0) {
      try {
        bodyMd = adfToMarkdown(JSON.parse(value));
      } catch {
        bodyMd = "";
      }
    }
    return {
      id: json.id ?? id,
      title: json.title ?? "",
      spaceKey: null, // v2 returns spaceId; resolution to key happens at the route layer
      updatedAt: json.version?.createdAt ?? "",
      bodyMd,
      raw: json,
    };
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
      throw new Error(`Confluence request failed: ${res.status} ${res.statusText} ${text}`);
    }
    return (await res.json()) as unknown;
  }
}

// ---------- Search-chip composition (CQL) ----------

export type ConfluenceChipKind = "space" | "author" | "updated" | "label";

export interface ConfluenceSearchChip {
  kind: ConfluenceChipKind;
  value: string;
}

export interface ComposeConfluenceSearchInput {
  /** Plain text the user typed; matched against title + body. */
  q?: string;
  filters?: ConfluenceSearchChip[];
}

const CQL_UPDATED_TOKEN: Record<string, string> = {
  today: 'lastmodified >= "now(-1d)"',
  this_week: 'lastmodified >= "now(-7d)"',
  this_month: 'lastmodified >= "now(-30d)"',
  this_year: 'lastmodified >= "now(-365d)"',
};

/**
 * Deterministic on-device chip→CQL composition. Always restricts to
 * `type = "page"` because the UI only renders pages today; advanced
 * (raw CQL) callers can override that by bypassing this helper.
 *
 * Quote escaping is CQL's `"` → `\"`.
 */
export function composeSearchCql(input: ComposeConfluenceSearchInput): string {
  const clauses: string[] = ['type = "page"'];
  const filters = input.filters ?? [];

  const q = (input.q ?? "").trim();
  if (q) {
    clauses.push(`(title ~ "${escapeCqlValue(q)}" OR text ~ "${escapeCqlValue(q)}")`);
  }

  for (const f of filters) {
    if (!f.value) continue;
    if (f.kind === "space") {
      clauses.push(`space = "${escapeCqlValue(f.value)}"`);
    } else if (f.kind === "author") {
      if (f.value === "me" || f.value === "currentUser") {
        clauses.push("creator = currentUser()");
      } else {
        clauses.push(`creator = "${escapeCqlValue(f.value)}"`);
      }
    } else if (f.kind === "updated") {
      const tok = CQL_UPDATED_TOKEN[f.value];
      if (tok) clauses.push(tok);
    } else if (f.kind === "label") {
      clauses.push(`label = "${escapeCqlValue(f.value)}"`);
    }
  }

  return `${clauses.join(" AND ")} ORDER BY lastmodified DESC`;
}

function escapeCqlValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
