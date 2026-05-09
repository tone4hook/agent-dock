import type { AgentRunInput, StartOpts } from "../types.js";

const UNSET_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
];

export function baseStartOpts(input: AgentRunInput): StartOpts {
  return {
    model: input.modelHint || undefined,
    workingDirectory: input.workingDirectory || undefined,
    permissionPolicy: { mode: input.permissionMode },
    unsetEnv: [...UNSET_ENV],
  };
}
