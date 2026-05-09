import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraClient } from "../src/jira.js";
import { ConfluenceClient } from "../src/confluence.js";
import {
  basicAuthHeader,
  loadAtlassianCreds,
  saveAtlassianCreds,
  setKeytarOverride,
  clearAtlassianCreds,
} from "../src/keychain.js";

const SITE = "https://test.atlassian.net";
const creds = { siteUrl: SITE, email: "user@example.com", apiToken: "tok" };

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

let calls: FetchCall[];
let originalFetch: typeof globalThis.fetch;

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("JiraClient", () => {
  it("search builds correct URL + Basic auth header", async () => {
    stubFetch((url) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe(`${SITE}/rest/api/3/search/jql`);
      expect(u.searchParams.get("jql")).toBe("project = ABC");
      expect(u.searchParams.get("maxResults")).toBe("25");
      expect(u.searchParams.get("fields")).toBe("summary,status,assignee,updated");
      expect(u.searchParams.has("startAt")).toBe(false); // legacy offset gone
      return jsonResponse({
        issues: [
          {
            key: "ABC-1",
            fields: {
              summary: "an issue",
              status: { name: "Open" },
              assignee: { displayName: "Alice" },
              updated: "2026-05-04T10:00:00.000Z",
            },
          },
        ],
        nextPageToken: "tok-2",
        isLast: false,
      });
    });

    const client = new JiraClient(creds);
    const res = await client.search("project = ABC");
    expect(calls).toHaveLength(1);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      basicAuthHeader(creds),
    );
    expect(res.nextPageToken).toBe("tok-2");
    expect(res.isLast).toBe(false);
    expect(res.issues[0]).toEqual({
      key: "ABC-1",
      summary: "an issue",
      status: "Open",
      assignee: "Alice",
      updated: "2026-05-04T10:00:00.000Z",
    });
  });

  it("getIssue parses ADF description into markdown", async () => {
    const adfDescription = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
      ],
    };
    stubFetch((url) => {
      expect(url.startsWith(`${SITE}/rest/api/3/issue/ABC-1`)).toBe(true);
      return jsonResponse({
        key: "ABC-1",
        fields: {
          summary: "an issue",
          status: { name: "Open" },
          assignee: null,
          reporter: { displayName: "Bob" },
          updated: "2026-05-04T10:00:00.000Z",
          description: adfDescription,
        },
      });
    });

    const detail = await new JiraClient(creds).getIssue("ABC-1");
    expect(detail.descriptionMd).toBe("hello world\n");
    expect(detail.assignee).toBeNull();
    expect(detail.reporter).toBe("Bob");
  });

  it("throws on non-2xx", async () => {
    stubFetch(() => new Response("not found", { status: 404, statusText: "Not Found" }));
    await expect(new JiraClient(creds).getIssue("MISS-1")).rejects.toThrow(/404/);
  });
});

describe("ConfluenceClient", () => {
  it("searchPages targets /wiki/rest/api/content/search with cql", async () => {
    stubFetch((url) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe(`${SITE}/wiki/rest/api/content/search`);
      expect(u.searchParams.get("cql")).toBe("type = page");
      expect(u.searchParams.get("limit")).toBe("25");
      return jsonResponse({
        results: [
          {
            id: "12345",
            title: "Hello",
            space: { key: "ENG" },
            version: { when: "2026-05-04T10:00:00.000Z" },
          },
        ],
        size: 1,
        totalSize: 1,
      });
    });

    const res = await new ConfluenceClient(creds).searchPages("type = page");
    expect(res.total).toBe(1);
    expect(res.results[0]).toEqual({
      id: "12345",
      title: "Hello",
      spaceKey: "ENG",
      updatedAt: "2026-05-04T10:00:00.000Z",
    });
  });

  it("getPage decodes nested ADF body", async () => {
    const innerAdf = JSON.stringify({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "page body" }] },
      ],
    });
    stubFetch((url) => {
      expect(url.startsWith(`${SITE}/wiki/api/v2/pages/12345`)).toBe(true);
      return jsonResponse({
        id: "12345",
        title: "Hello",
        version: { createdAt: "2026-05-04T10:00:00.000Z" },
        body: { atlas_doc_format: { value: innerAdf } },
      });
    });

    const detail = await new ConfluenceClient(creds).getPage("12345");
    expect(detail.bodyMd).toBe("page body\n");
    expect(detail.title).toBe("Hello");
  });
});

describe("Keychain helpers (with in-memory override)", () => {
  it("save/load round-trips creds; clear removes them", async () => {
    const store = new Map<string, string>();
    setKeytarOverride({
      async getPassword(_s, a) {
        return store.get(a) ?? null;
      },
      async setPassword(_s, a, v) {
        store.set(a, v);
      },
      async deletePassword(_s, a) {
        return store.delete(a);
      },
    });

    await saveAtlassianCreds(creds);
    const loaded = await loadAtlassianCreds();
    expect(loaded).toEqual({ ...creds, boardId: null });

    expect(await clearAtlassianCreds()).toBe(true);
    expect(await loadAtlassianCreds()).toBeNull();

    setKeytarOverride(null);
  });

  it("rejects empty fields", async () => {
    setKeytarOverride({
      async getPassword() {
        return null;
      },
      async setPassword() {},
      async deletePassword() {
        return false;
      },
    });
    await expect(
      saveAtlassianCreds({ siteUrl: "", email: "", apiToken: "" }),
    ).rejects.toThrow(/required/);
    setKeytarOverride(null);
  });

  it("normalizes trailing slash on siteUrl", async () => {
    const store = new Map<string, string>();
    setKeytarOverride({
      async getPassword(_s, a) {
        return store.get(a) ?? null;
      },
      async setPassword(_s, a, v) {
        store.set(a, v);
      },
      async deletePassword(_s, a) {
        return store.delete(a);
      },
    });
    await saveAtlassianCreds({ ...creds, siteUrl: `${SITE}////` });
    const loaded = await loadAtlassianCreds();
    expect(loaded?.siteUrl).toBe(SITE);
    setKeytarOverride(null);
  });
});
