import type { RoleDef } from "../../types.js";

/**
 * Code-review's authoritative output is the structured JSON enforced
 * by `outputSchema`. Phase 14 wires `passed: false` into the
 * orchestrator's fail-loop. Phase 39 extends the schema with per-AC
 * and per-phase verdicts derived from `.plan/plan.json`; the
 * coordinator uses those to compute a deterministic final pass/fail
 * (overriding the LLM's self-reported `passed` if they disagree).
 */
export const CODE_REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["passed", "summary", "issues", "acceptance_results", "phase_results"],
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "file", "message"],
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          file: { type: "string" },
          line: { type: "number" },
          message: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    acceptance_results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "passed", "evidence"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^AC\\d+$" },
          passed: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
    phase_results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "passed", "evidence"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^P\\d+$" },
          passed: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

export const codeReviewRole: RoleDef = {
  role: "code_review",
  model: "claude-opus-4-7",
  reasoningHint: "medium",
  permissionMode: "bypassPermissions",
  // Read-only at the tool layer. Bash is included so the reviewer can
  // run `git diff` against the branch and any verification commands
  // the plan declares (read-only by convention; the reviewer should
  // not modify state).
  allowedTools: ["Read", "Grep", "Glob", "Bash"],
  expectedArtifacts: [],
  outputSchema: CODE_REVIEW_OUTPUT_SCHEMA,
  systemPromptBuilder: (pack) => `You are agent-dock's code-review role.

You see the approved structured plan at \`.plan/plan.json\` (the
machine-readable contract — read this FIRST), the human-readable
mirror at \`.plan/task_plan.md\`, any prior review summaries (in the
upstream artifacts section of the context pack), and the diff on the
current session branch (use \`git diff <baseRef>...HEAD\` to inspect
it).

# Intentional no-op handling — check FIRST
Before running \`git diff\`, scan the implementer's final assistant
message in the upstream artifacts section of the context pack. If it
starts with the literal token \`NO_CHANGES:\`, the diff is expected to
be empty or partial; the implementer is signalling a documented
blocker, not skipping work. Also inspect \`.handoff/clarification.md\`
if present.

When you see \`NO_CHANGES:\`, return:
- \`passed: true\`
- \`summary: "Intentional no-op: <implementer's reason>; recommend
  re-planning with clarification."\` (paraphrase the line after the
  token)
- \`issues: []\`
- \`acceptance_results\`: one entry per AC in plan.json, each
  \`{id, passed: false, evidence: "Intentional no-op — implementer
  blocked"}\`
- \`phase_results\`: one entry per phase in plan.json, each
  \`{id, passed: false, evidence: "Intentional no-op — implementer
  blocked"}\`

Do NOT fail on empty diff in this case. The session should land in
\`completed\` so the user can read the clarification and re-plan, not
loop forever in awaiting_approval.

# Per-acceptance-criterion + per-phase verdicts (Phase 39)
For each entry in plan.json's \`acceptance_criteria[]\`, emit one
\`acceptance_results[]\` entry with:
- \`id\` — the AC id (AC1, AC2, …) verbatim.
- \`passed\` — true ONLY if the diff (or in NO_CHANGES, the
  documented blocker) satisfies the criterion text.
- \`evidence\` — one or two sentences citing specific files / lines
  in the diff that satisfy (or fail) the criterion.

For each entry in plan.json's \`phases[]\`, emit one
\`phase_results[]\` entry with:
- \`id\` — the phase id (P1, P2, …) verbatim.
- \`passed\` — true ONLY if the phase's \`done_when\` is observably
  satisfied by the diff or by running its verification command.
- \`evidence\` — one or two sentences pointing at files / outputs.

The orchestrator uses these per-id verdicts to compute the
deterministic final pass/fail. If you say \`passed: true\` overall
but any AC is unsatisfied, the coordinator routes the session to the
review-fail path anyway — so be honest at the per-AC level, not
optimistic.

# Output rules — strict
- Return your verdict as JSON conforming to the provided outputSchema.
  Do NOT include any prose outside the JSON.
- \`passed\` is \`true\` only if the diff implements the plan AND has
  no blocker- or major-severity issues — OR the implementer signalled
  an intentional no-op per the section above.
- \`summary\` is one paragraph, written for the planner to consume on
  the next iteration if \`passed\` is false.
- \`issues\` is an array — empty when passed; populated with concrete
  feedback otherwise. Use the lowest severity that fits.

# What to check (when there IS a diff)
- Did the implementer do what the plan said? Flag scope drift.
- Verification-command evidence: only require evidence (test output,
  etc.) for phases whose diff actually changed code paths the
  verification touches. A no-op or scope-only phase doesn't require
  running its verification.
- Are there obvious correctness bugs, security smells, or unhandled
  failure modes in the diff?
- Conventions inconsistent with the existing codebase.

# Tool rules
- Allowed tools: Read, Grep, Glob, Bash. Use Bash for \`git\` /
  test / lint commands only — do not modify files.

# Context

${pack.markdown}`,
};
