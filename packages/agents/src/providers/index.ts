import type { AgentProvider } from "@agent-dock/shared";
import type { ProviderAdapter } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";
import { codexAdapter } from "./codex.js";

export const providerRegistry: Record<AgentProvider, ProviderAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
};

export function getProviderAdapter(id: AgentProvider): ProviderAdapter {
  const adapter = providerRegistry[id];
  if (!adapter) throw new Error(`Unknown agent provider: ${id}`);
  return adapter;
}
