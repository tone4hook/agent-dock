import type { ProviderAdapter } from "../types.js";
import { baseStartOpts } from "./base.js";

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  buildStartOpts(input) {
    return baseStartOpts(input);
  },
};
