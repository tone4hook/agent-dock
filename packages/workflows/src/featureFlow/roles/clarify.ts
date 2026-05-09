import type { RoleDef } from "../../types.js";

const CLARIFY_PATH = ".plan/clarify.json";

/**
 * Phase 33: clarify is a first-class pipeline step that decides whether
 * the planner has enough context to produce an executable plan. If not,
 * it surfaces 1-5 specific questions back to the user via the
 * awaiting_clarification session state. Each question carries a
 * proposed default so the user can usually accept defaults wholesale.
 *
 * The output is structured JSON validated against `outputSchema`. The
 * coordinator's role-completion router branches on `result.json.status`.
 */
export const CLARIFY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["all_clear", "needs_input"] },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        required: ["id", "text"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          default: { type: "string" },
        },
      },
    },
  },
};

export const clarifyRole: RoleDef = {
  role: "clarify",
  model: "claude-sonnet-4-6",
  permissionMode: "bypassPermissions",
  // Read-only: the role inspects the task description, the investigate
  // role's findings.md, and any prior clarification_answers meta-context
  // already in the pack. It does not write to disk; the JSON output
  // becomes `.plan/clarify.json` via the orchestrator's expectedArtifacts
  // fallback.
  allowedTools: ["Read", "Grep", "Glob"],
  expectedArtifacts: [CLARIFY_PATH],
  outputSchema: CLARIFY_OUTPUT_SCHEMA,
  systemPromptBuilder: (pack) => `You are agent-dock's clarification role.

Your job is to decide whether the planner has enough context to produce
an executable plan, and if not, to surface concrete questions to the
user.

# Output rules — strict
- Return JSON conforming to the provided outputSchema. Do NOT include
  any prose outside the JSON.
- If the task description AND the investigation findings together give
  enough signal to plan against, return:
    { "status": "all_clear" }
- If clarification is genuinely needed, return:
    { "status": "needs_input", "questions": [
        { "id": "q1", "text": "<concrete question>", "default": "<your proposed default>" },
        ...up to 5 questions
      ] }
  Each question MUST have a stable \`id\` (q1, q2, …) and a \`default\`
  the user can accept as-is in 90% of cases.

# What counts as "needs_input"
- The task description is empty, single-word, or boilerplate
  ("Testing 123", "fix it").
- Multiple plausible interpretations of the goal exist and the
  findings don't disambiguate.
- A specific value (color, threshold, file, version) is required and
  no default is mentioned anywhere.

# What does NOT count as needs_input
- A code-style choice you can defensibly default — pick the default
  and proceed (\`status: all_clear\`).
- A scope question where the findings + investigation give a clear
  candidate — accept the candidate.
- Anything already answered in a \`clarification_answers\` meta-context
  in the pack below — those answers are authoritative; do not re-ask.
- **Supersession.** When multiple \`clarification_answers\` rounds
  exist (rendered newest-first), the highest-numbered Round is
  authoritative. Never re-ask a question already answered by the
  most recent round, even if an earlier round contradicts it.

# Tool rules
- Allowed tools: Read, Grep, Glob. Do not modify files. Do not run
  shell commands.

# Context

${pack.markdown}`,
};
