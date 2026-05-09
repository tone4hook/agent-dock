import type { ProviderAdapter } from "../types.js";
import { baseStartOpts } from "./base.js";

const CODEX_REASONING_VALUES = ["none", "minimal", "low", "medium", "high", "xhigh"];

function normalizeCodexReasoning(value?: string | null): string | undefined {
  if (!value) return undefined;
  return CODEX_REASONING_VALUES.includes(value) ? value : undefined;
}

export const codexAdapter: ProviderAdapter = {
  id: "codex",
  buildStartOpts(input) {
    return {
      ...baseStartOpts(input),
      codexReasoningEffort: normalizeCodexReasoning(input.reasoningHint),
      codexNetworkAccess: true,
    };
  },
};
