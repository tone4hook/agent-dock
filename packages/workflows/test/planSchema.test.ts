import { describe, expect, it } from "vitest";
import { validatePlan, planSchema, PLAN_OUTPUT_SCHEMA } from "../src/index.js";

interface MutablePlan {
  task_summary: string;
  acceptance_criteria: Array<{ id: string; text: string }>;
  phases: Array<{
    id: string;
    title: string;
    goal: string;
    files: string[];
    done_when: string;
    covers_acceptance: string[];
  }>;
  open_questions: string[];
  out_of_scope: string[];
}

const goldenPlan: MutablePlan = {
  task_summary:
    "Add Jira board id to onboarding so the sprint API can be queried.",
  acceptance_criteria: [
    {
      id: "AC1",
      text: "User can paste a Jira board id during onboarding and have it saved.",
    },
    {
      id: "AC2",
      text: "Settings exposes the board id with edit + save behavior.",
    },
  ],
  phases: [
    {
      id: "P1",
      title: "Onboarding board-id field",
      goal: "Add a board-id input to the Atlassian onboarding step and persist it via existing settings PUT route.",
      files: ["apps/web/src/views/Onboarding.tsx", "packages/db/migrations/008.ts"],
      done_when:
        "Onboarding step renders a text input that PUTs jiraBoardId; saved value reads back via GET /api/settings.",
      covers_acceptance: ["AC1"],
    },
    {
      id: "P2",
      title: "Settings board-id editor",
      goal: "Add a Settings card that loads + saves jiraBoardId via the same settings endpoint.",
      files: ["apps/web/src/views/Settings.tsx"],
      done_when:
        "Settings page surfaces a board-id input bound to the same settings record; save toast appears on success.",
      covers_acceptance: ["AC2"],
    },
  ],
  open_questions: [],
  out_of_scope: ["Multi-board selection (defer to v2)"],
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("validatePlan", () => {
  it("accepts a gapless plan and returns ok=true with the parsed plan", () => {
    const result = validatePlan(goldenPlan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.acceptance_criteria).toHaveLength(2);
      expect(result.plan.phases).toHaveLength(2);
    }
  });

  it("rejects when acceptance_criteria is missing/empty", () => {
    const bad = clone(goldenPlan);
    bad.acceptance_criteria = [];
    const result = validatePlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gapsKind).toBe("other");
      expect(result.errors.join("\n")).toMatch(/acceptance_criteria/i);
    }
  });

  it("rejects when an acceptance criterion is not covered by any phase", () => {
    const bad = clone(goldenPlan);
    bad.acceptance_criteria.push({
      id: "AC3",
      text: "Onboarding shows a 'test connection' button.",
    });
    const result = validatePlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gapsKind).toBe("other");
      expect(result.errors.some((e) => /AC3/.test(e) && /not covered/i.test(e))).toBe(true);
    }
  });

  it("rejects when a phase done_when is vague (starts with TBD)", () => {
    const bad = clone(goldenPlan);
    bad.phases[0].done_when = "TBD: figure it out later when more info exists";
    const result = validatePlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gapsKind).toBe("other");
      expect(result.errors.join("\n")).toMatch(/vague/i);
    }
  });

  it("rejects when a phase has no files declared", () => {
    const bad = clone(goldenPlan);
    bad.phases[0].files = [];
    const result = validatePlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gapsKind).toBe("other");
      expect(result.errors.join("\n")).toMatch(/files/i);
    }
  });

  it("returns gapsKind='open_questions' when only open_questions is non-empty and shape is otherwise clean", () => {
    const bad = clone(goldenPlan);
    bad.open_questions = ["Should onboarding accept multiple boards?"];
    const result = validatePlan(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gapsKind).toBe("open_questions");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/multiple boards/);
      expect(result.plan).not.toBeNull();
    }
  });
});

describe("PLAN_OUTPUT_SCHEMA", () => {
  it("is a JSON-Schema object with the load-bearing fields", () => {
    expect(PLAN_OUTPUT_SCHEMA.type).toBe("object");
    expect((PLAN_OUTPUT_SCHEMA as any).required).toEqual(
      expect.arrayContaining([
        "task_summary",
        "acceptance_criteria",
        "phases",
        "open_questions",
        "out_of_scope",
      ]),
    );
  });
});

describe("planSchema (Zod)", () => {
  it("infers the Plan type with stable shape", () => {
    const parsed = planSchema.parse(goldenPlan);
    expect(parsed.task_summary.length).toBeGreaterThan(0);
  });
});
