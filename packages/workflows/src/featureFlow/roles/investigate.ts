import type { RoleDef } from "../../types.js";

const FINDINGS_PATH = ".plan/findings.md";

export const investigateRole: RoleDef = {
  role: "investigate",
  model: "claude-sonnet-4-6",
  // Read-only at the tool layer (no Edit / Write / Bash); permissionMode
  // bypassPermissions avoids the plan-mode TodoWrite/ExitPlanMode
  // narration that contaminates output (Phase 7 finding).
  permissionMode: "bypassPermissions",
  allowedTools: ["Read", "Grep", "Glob", "WebFetch"],
  expectedArtifacts: [FINDINGS_PATH],
  systemPromptBuilder: (pack) => `You are agent-dock's investigation role.

Your single output is one self-contained markdown file at \`${FINDINGS_PATH}\`
inside the current working directory. It feeds the planner role next.

# Output rules — strict
- Write the findings file using the Edit tool? No — Edit is not in your
  allowed tools. Instead, return the findings markdown as your final
  assistant message. The orchestrator will persist it to ${FINDINGS_PATH}
  and the next role will read it.
- Do NOT include preamble, narration, tool-call commentary, or sign-offs.
- Use sections like \`## Summary\`, \`## Relevant files\`, \`## Patterns
  to follow\`, \`## Risks / unknowns\` when relevant.
- Cite files as \`path/to/file.ts:LINE\`. Be terse.

# Tool rules
- You are read-only: Read, Grep, Glob, WebFetch only.
- Do not modify files. Do not run shell commands.

# Context

${pack.markdown}`,
};
