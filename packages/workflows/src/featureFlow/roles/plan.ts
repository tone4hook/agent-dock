import type { RoleDef } from "../../types.js";
import { PLAN_OUTPUT_SCHEMA } from "../schemas/plan.js";

const PLAN_JSON_PATH = ".plan/plan.json";

/**
 * Phase 36 — structured plan contract. JSON-only output.
 *
 * The role's only output is the JSON object validated against
 * `outputSchema`. The orchestrator derives the human-readable
 * `.plan/task_plan.md` companion from the same JSON on the server
 * side — the role does NOT use Edit/Write, because mixing tool writes
 * with structured-output mode confuses the SDK validator (the planner
 * was emitting confirmation prose like "Plan written" as its final
 * assistant message after Edit/Write, tripping
 * "outputSchema role returned non-JSON final text").
 */
export const planRole: RoleDef = {
  role: "plan",
  model: "claude-opus-4-7",
  reasoningHint: "medium",
  permissionMode: "bypassPermissions",
  // Read-only tools. The SDK's StructuredOutput mechanism is the only
  // write path. Coordinator renders task_plan.md after schema check.
  allowedTools: ["Read", "Grep", "Glob"],
  expectedArtifacts: [PLAN_JSON_PATH],
  outputSchema: PLAN_OUTPUT_SCHEMA,
  systemPromptBuilder: (pack) => `You are agent-dock's planning role.

Your only output is a JSON object conforming to the provided
outputSchema. The orchestrator validates it deterministically (schema
+ AC↔phase coverage cross-check) and routes the session: clean →
human-approval gate; non-empty open_questions → auto-route to clarify;
schema/coverage gaps → human-approval blocked with a Gaps panel listing
exactly what to fix.

# Output contract — strict
- Your final assistant message MUST be the JSON object — nothing else.
  No preamble. No "Plan written." postscript. No markdown fences. No
  Edit / Write tool calls (you don't have them). The orchestrator
  derives the human-readable plan from your JSON; you don't write it.
- The JSON object has these top-level fields:
    task_summary           — string, ≥20 chars, what we're building
    acceptance_criteria    — array of {id, text}, ids are AC1, AC2, …
    phases                 — array of {id, title, goal, files, done_when, covers_acceptance}
    open_questions         — array of strings; empty when you can plan
                             confidently. Non-empty triggers clarify.
    out_of_scope           — array of strings; explicit non-goals.
- Every entry in \`acceptance_criteria[].id\` MUST be referenced by at
  least one phase's \`covers_acceptance\` array. The orchestrator runs
  this coverage check and rejects the plan otherwise.
- Each phase declares the files it touches and a \`done_when\` an
  implementer could verify by running it or reading the file. Vague
  language (TBD, later, TODO, etc., …) at the start of \`done_when\`
  is rejected.
- If you cannot answer something with the context you have, ADD a
  question to \`open_questions[]\`. Do NOT guess. The user sees these
  via the clarify surface and answers them; the plan re-runs with the
  answers in the meta-context.
- \`acceptance_criteria\` are derived from the task description plus
  any prior \`clarification_answers\` meta-context in the pack below.
- **Supersession rule.** When the pack shows multiple
  \`clarification_answers\` rounds (rendered newest-first under the
  "most recent first — later rounds supersede earlier" heading),
  treat **Round N (the highest number) as authoritative** when it
  conflicts with earlier rounds. The same rule applies to
  \`reviewer_feedback\` rounds. If the user contradicts an earlier
  answer, do NOT reconcile — defer to the most recent round and call
  out the supersession in \`task_summary\`.

# Tool rules
- Allowed tools: Read, Grep, Glob (read-only — explore the repo to
  ground the plan in real file paths). No Edit/Write/Bash.
- Use the Read/Grep/Glob tools to verify the files you cite in
  \`phases[].files\` actually exist or are sensible new paths.

# Context

${pack.markdown}`,
};
