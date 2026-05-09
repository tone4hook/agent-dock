import { z } from "zod";

/**
 * Phase 36 — structured plan contract.
 *
 * The plan role emits a JSON object conforming to `planSchema` as its
 * final-text output (validated by the SDK's `outputSchema` wiring) and,
 * separately, writes a human-readable `task_plan.md` derived from the
 * same JSON. The orchestrator routes off `validatePlan` results:
 *  - `ok=true`             → awaiting_approval
 *  - `gapsKind="open_questions"` → auto-route back to clarify
 *  - `gapsKind="other"`    → awaiting_approval with a Gaps panel
 */

const AC_ID_RE = /^AC\d+$/;
const PHASE_ID_RE = /^P\d+$/;

const VAGUE_PREFIX_RE = /^(tbd|later|todo|etc\.?|\.\.\.)/i;

export const acceptanceCriterionSchema = z.object({
  id: z.string().regex(AC_ID_RE, "id must match /^AC\\d+$/"),
  text: z.string().min(10, "text must be at least 10 chars"),
});

export const phaseSchema = z.object({
  id: z.string().regex(PHASE_ID_RE, "id must match /^P\\d+$/"),
  title: z.string().min(3, "title must be at least 3 chars"),
  goal: z.string().min(20, "goal must be at least 20 chars"),
  files: z
    .array(z.string().min(1))
    .min(1, "files must declare at least 1 path"),
  done_when: z
    .string()
    .min(20, "done_when must be at least 20 chars")
    .refine(
      (s) => !VAGUE_PREFIX_RE.test(s.trim()),
      {
        message:
          "done_when looks vague (starts with TBD/later/TODO/etc/...). Rewrite as an observable check.",
      },
    ),
  covers_acceptance: z
    .array(z.string().regex(AC_ID_RE))
    .min(1, "covers_acceptance must reference at least 1 acceptance id"),
});

export const planSchema = z.object({
  task_summary: z.string().min(20, "task_summary must be at least 20 chars"),
  acceptance_criteria: z
    .array(acceptanceCriterionSchema)
    .min(1, "acceptance_criteria must list at least 1 entry"),
  phases: z.array(phaseSchema).min(1, "phases must declare at least 1 phase"),
  open_questions: z.array(z.string().min(5)),
  out_of_scope: z.array(z.string()),
});

export type Plan = z.infer<typeof planSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type PlanPhase = z.infer<typeof phaseSchema>;

export type PlanValidationResult =
  | { ok: true; plan: Plan }
  | {
      ok: false;
      plan: Plan | null;
      errors: string[];
      gapsKind: "open_questions" | "other";
    };

type PlanIssue = z.ZodSafeParseResult<Plan> extends { error?: infer E }
  ? E extends { issues: infer I }
    ? I extends ReadonlyArray<infer X>
      ? X
      : never
    : never
  : never;

function formatIssue(issue: PlanIssue): string {
  const path = (issue as { path: ReadonlyArray<unknown> }).path;
  const message = (issue as { message: string }).message;
  const pathStr = path.length ? path.join(".") : "(root)";
  return `${pathStr}: ${message}`;
}

/**
 * Deterministic plan validator. Runs Zod parse, then a cross-check
 * (every `acceptance_criteria[].id` is referenced by some
 * `phases[].covers_acceptance`), then classifies the failure mode.
 *
 * `gapsKind="open_questions"` is reserved for the case where the *only*
 * problem is a non-empty `open_questions[]` and the rest of the shape
 * is clean — that's the auto-route-to-clarify trigger. Any other
 * combination of issues (including open_questions plus something else)
 * is `gapsKind="other"`, which means the UI shows a Gaps panel and the
 * Approve button is disabled.
 */
export function validatePlan(json: unknown): PlanValidationResult {
  const parsed = planSchema.safeParse(json);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(formatIssue);
    return { ok: false, plan: null, errors, gapsKind: "other" };
  }

  const plan = parsed.data;

  const acIds = new Set(plan.acceptance_criteria.map((a) => a.id));
  const coveredIds = new Set<string>();
  for (const phase of plan.phases) {
    for (const id of phase.covers_acceptance) coveredIds.add(id);
  }

  const errors: string[] = [];
  for (const id of acIds) {
    if (!coveredIds.has(id)) {
      errors.push(
        `acceptance_criterion ${id} is not covered by any phase's covers_acceptance`,
      );
    }
  }
  for (const id of coveredIds) {
    if (!acIds.has(id)) {
      errors.push(
        `covers_acceptance references unknown acceptance id ${id}`,
      );
    }
  }

  const hasOpenQuestions = plan.open_questions.length > 0;

  if (errors.length === 0 && hasOpenQuestions) {
    return {
      ok: false,
      plan,
      errors: plan.open_questions.map((q) => q),
      gapsKind: "open_questions",
    };
  }

  if (errors.length > 0 || hasOpenQuestions) {
    if (hasOpenQuestions) {
      for (const q of plan.open_questions) {
        errors.push(`open_question: ${q}`);
      }
    }
    return { ok: false, plan, errors, gapsKind: "other" };
  }

  return { ok: true, plan };
}

/**
 * Hand-written JSON Schema mirror of `planSchema` for the SDK's
 * `outputSchema`. Kept in sync with the Zod schema by a runtime test
 * that round-trips a fixture through both.
 */
export const PLAN_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [
    "task_summary",
    "acceptance_criteria",
    "phases",
    "open_questions",
    "out_of_scope",
  ],
  additionalProperties: false,
  properties: {
    task_summary: { type: "string", minLength: 20 },
    acceptance_criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "text"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^AC\\d+$" },
          text: { type: "string", minLength: 10 },
        },
      },
    },
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "id",
          "title",
          "goal",
          "files",
          "done_when",
          "covers_acceptance",
        ],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^P\\d+$" },
          title: { type: "string", minLength: 3 },
          goal: { type: "string", minLength: 20 },
          files: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
          done_when: { type: "string", minLength: 20 },
          covers_acceptance: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: "^AC\\d+$" },
          },
        },
      },
    },
    open_questions: {
      type: "array",
      items: { type: "string", minLength: 5 },
    },
    out_of_scope: {
      type: "array",
      items: { type: "string" },
    },
  },
};
