import type { ProviderAdapter } from "../types.js";
import { baseStartOpts } from "./base.js";

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  buildStartOpts(input) {
    return baseStartOpts(input);
  },
};
