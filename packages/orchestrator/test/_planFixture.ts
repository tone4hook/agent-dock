/**
 * Phase 37 — shared test helper for the structured plan contract.
 *
 * The plan role's outputSchema (Phase 36) demands a JSON object passing
 * `validatePlan`. Each orchestrator test that drives the pipeline
 * through `plan` returns this fixture (or an override of it) so the
 * coordinator's plan-completion router lands on `awaiting_approval`.
 */
export interface PlanFixtureOverrides {
  task_summary?: string;
  open_questions?: string[];
  /** Replace the entire phases array. */
  phases?: PlanFixturePhase[];
  /** Replace the entire acceptance_criteria array. */
  acceptance_criteria?: PlanFixtureAC[];
  /** Surgical edits applied AFTER overrides — last-writer-wins. */
  patch?: (plan: PlanFixture) => void;
}

export interface PlanFixtureAC {
  id: string;
  text: string;
}
export interface PlanFixturePhase {
  id: string;
  title: string;
  goal: string;
  files: string[];
  done_when: string;
  covers_acceptance: string[];
}
export interface PlanFixture {
  task_summary: string;
  acceptance_criteria: PlanFixtureAC[];
  phases: PlanFixturePhase[];
  open_questions: string[];
  out_of_scope: string[];
}

export function makePlanJson(overrides: PlanFixtureOverrides = {}): PlanFixture {
  const plan: PlanFixture = {
    task_summary:
      overrides.task_summary ??
      "Tighten the Sensors gap to the spec'd value across the dashboard layout.",
    acceptance_criteria: overrides.acceptance_criteria ?? [
      {
        id: "AC1",
        text: "Sensors layout uses a 32px gap on desktop and tablet breakpoints.",
      },
    ],
    phases: overrides.phases ?? [
      {
        id: "P1",
        title: "Apply 32px gap token",
        goal: "Replace the legacy 24px gap token with the design-system-approved 32px token in the Sensors grid.",
        files: ["src/views/Sensors.tsx", "src/styles/tokens.css"],
        done_when:
          "Sensors page renders with a 32px gap; visual diff vs main shows only the gap delta.",
        covers_acceptance: ["AC1"],
      },
    ],
    open_questions: overrides.open_questions ?? [],
    out_of_scope: ["Mobile breakpoints (deferred to follow-up)"],
  };
  overrides.patch?.(plan);
  return plan;
}

export function planJsonText(overrides: PlanFixtureOverrides = {}): string {
  return JSON.stringify(makePlanJson(overrides));
}
