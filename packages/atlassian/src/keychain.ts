import type { AtlassianCreds } from "./types.js";

const SERVICE = "agent-dock-atlassian";
const ACCOUNT = "creds";

// keytar is a native module; we lazy-require so that test environments
// without the prebuilt binary can substitute via `setKeytarOverride`.

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let override: KeytarModule | null = null;

export function setKeytarOverride(impl: KeytarModule | null): void {
  override = impl;
}

async function loadKeytar(): Promise<KeytarModule> {
  if (override) return override;
  const mod = (await import("keytar")) as unknown as { default: KeytarModule } | KeytarModule;
  return "default" in mod ? mod.default : mod;
}

export async function saveAtlassianCreds(creds: AtlassianCreds): Promise<void> {
  const keytar = await loadKeytar();
  const boardId = creds.boardId ? String(creds.boardId).trim() : "";
  if (boardId && !/^\d+$/.test(boardId)) {
    throw new Error("boardId must be digits only (e.g. 42)");
  }
  const normalized: AtlassianCreds = {
    siteUrl: creds.siteUrl.replace(/\/+$/, ""),
    email: creds.email.trim(),
    apiToken: creds.apiToken,
    boardId: boardId || null,
  };
  if (!normalized.siteUrl || !normalized.email || !normalized.apiToken) {
    throw new Error("siteUrl, email, and apiToken are all required");
  }
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(normalized));
}

export async function loadAtlassianCreds(): Promise<AtlassianCreds | null> {
  const keytar = await loadKeytar();
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AtlassianCreds>;
    if (!parsed.siteUrl || !parsed.email || !parsed.apiToken) return null;
    return {
      siteUrl: parsed.siteUrl,
      email: parsed.email,
      apiToken: parsed.apiToken,
      boardId: parsed.boardId ?? null,
    };
  } catch {
    return null;
  }
}

export async function clearAtlassianCreds(): Promise<boolean> {
  const keytar = await loadKeytar();
  return keytar.deletePassword(SERVICE, ACCOUNT);
}

export function basicAuthHeader(creds: Pick<AtlassianCreds, "email" | "apiToken">): string {
  const token = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
  return `Basic ${token}`;
}

export const ATLASSIAN_KEYCHAIN_SERVICE = SERVICE;
export const ATLASSIAN_KEYCHAIN_ACCOUNT = ACCOUNT;
