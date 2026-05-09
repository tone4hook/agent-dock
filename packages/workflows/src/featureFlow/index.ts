import { assertWorkflowDef, type WorkflowDef } from "../types.js";
import { clarifyRole } from "./roles/clarify.js";
import { codeReviewRole } from "./roles/codeReview.js";
import { implementRole } from "./roles/implement.js";
import { investigateRole } from "./roles/investigate.js";
import { planRole } from "./roles/plan.js";

/**
 * Phase 33 originally inserted a `validate` step between plan and
 * implement to gate plan approval on a fast LLM check. In practice the
 * validator was unreliable (Haiku returning non-JSON, over-strict
 * verdicts) and offered no escape — every session failed at validate
 * with no way through. Reverted (post-Phase-34) back to:
 *
 *   investigate(0) → clarify(1) → plan(2) → implement(3) → code_review(4)
 *
 * The clarify step is retained — Phase 34's fail-soft path makes it
 * a non-blocking optimization rather than a gate.
 */
export const featureFlow: WorkflowDef = (() => {
  const def: WorkflowDef = {
    id: "feature-flow",
    steps: [
      { role: "investigate", ord: 0 },
      { role: "clarify", ord: 1, dependsOn: ["investigate"] },
      { role: "plan", ord: 2, dependsOn: ["clarify"] },
      { role: "implement", ord: 3, dependsOn: ["plan"] },
      { role: "code_review", ord: 4, dependsOn: ["implement"] },
    ],
    roles: {
      investigate: investigateRole,
      clarify: clarifyRole,
      plan: planRole,
      implement: implementRole,
      code_review: codeReviewRole,
    },
  };
  assertWorkflowDef(def);
  return def;
})();

export const featureFlowId = featureFlow.id;
