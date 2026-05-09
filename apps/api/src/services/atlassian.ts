import {
  ConfluenceClient,
  JiraClient,
  clearAtlassianCreds,
  loadAtlassianCreds,
  saveAtlassianCreds,
  type AtlassianCreds,
} from "@agent-dock/atlassian";

export interface AtlassianStatus {
  connected: boolean;
  email: string | null;
  siteUrl: string | null;
  boardId: string | null;
}

interface CachedClients {
  jira: JiraClient;
  confluence: ConfluenceClient;
  email: string;
  siteUrl: string;
  boardId: string | null;
  /** Lazily resolved when first asked for (Sprint tab → board → projectKey). */
  projectKey: string | null;
}

/**
 * In-process cache around the Atlassian clients. Creds live in the
 * macOS Keychain (via keytar); this service reads them on first use,
 * builds clients, and rebuilds them whenever creds change.
 */
export class AtlassianService {
  private cache: CachedClients | null = null;

  async status(): Promise<AtlassianStatus> {
    const creds = await loadAtlassianCreds();
    if (!creds) return { connected: false, email: null, siteUrl: null, boardId: null };
    return {
      connected: true,
      email: creds.email,
      siteUrl: creds.siteUrl,
      boardId: creds.boardId ?? null,
    };
  }

  async saveCreds(creds: AtlassianCreds): Promise<AtlassianStatus> {
    await saveAtlassianCreds(creds);
    this.cache = null; // invalidate on rotation
    return this.status();
  }

  async clearCreds(): Promise<AtlassianStatus> {
    await clearAtlassianCreds();
    this.cache = null;
    return this.status();
  }

  async getJira(): Promise<JiraClient> {
    return (await this.getClients()).jira;
  }

  async getConfluence(): Promise<ConfluenceClient> {
    return (await this.getClients()).confluence;
  }

  async getBoardId(): Promise<string> {
    const c = await this.getClients();
    if (!c.boardId) {
      throw Object.assign(
        new Error(
          "Jira board id not configured. Add a numeric board id in Settings to use the Sprint tab.",
        ),
        { status: 412 },
      );
    }
    return c.boardId;
  }

  /** Resolve and cache the board's project key (used for chip-filter search). */
  async getProjectKey(): Promise<string | null> {
    const c = await this.getClients();
    if (c.projectKey != null || !c.boardId) return c.projectKey;
    try {
      c.projectKey = await c.jira.getBoardProjectKey(c.boardId);
    } catch {
      c.projectKey = null;
    }
    return c.projectKey;
  }

  private async getClients(): Promise<CachedClients> {
    if (this.cache) return this.cache;
    const creds = await loadAtlassianCreds();
    if (!creds) {
      throw new Error("Atlassian creds not configured. Set them in Settings.");
    }
    this.cache = {
      jira: new JiraClient(creds),
      confluence: new ConfluenceClient(creds),
      email: creds.email,
      siteUrl: creds.siteUrl,
      boardId: creds.boardId ?? null,
      projectKey: null,
    };
    return this.cache;
  }
}
