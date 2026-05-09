import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_OUTPUT_SCHEMA,
  assertWorkflowDef,
  buildContextPack,
  featureFlow,
  type ContextPackInput,
} from "../src/index.js";

describe("featureFlow definition", () => {
  it("declares the five roles in order with the right ordinals (validate reverted)", () => {
    const ords = featureFlow.steps.map((s) => `${s.ord}:${s.role}`);
    expect(ords).toEqual([
      "0:investigate",
      "1:clarify",
      "2:plan",
      "3:implement",
      "4:code_review",
    ]);
  });

  it("each downstream step depends on the previous one", () => {
    expect(featureFlow.steps[0].dependsOn).toBeUndefined();
    expect(featureFlow.steps[1].dependsOn).toEqual(["investigate"]);
    expect(featureFlow.steps[2].dependsOn).toEqual(["clarify"]);
    expect(featureFlow.steps[3].dependsOn).toEqual(["plan"]);
    expect(featureFlow.steps[4].dependsOn).toEqual(["implement"]);
  });

  it("assigns the right model + reasoning per role per the design", () => {
    expect(featureFlow.roles.investigate!.model).toBe("claude-sonnet-4-6");
    expect(featureFlow.roles.investigate!.reasoningHint).toBeUndefined();

    expect(featureFlow.roles.clarify!.model).toBe("claude-sonnet-4-6");

    expect(featureFlow.roles.plan!.model).toBe("claude-opus-4-7");
    expect(featureFlow.roles.plan!.reasoningHint).toBe("medium");

    expect(featureFlow.roles.implement!.model).toBe("claude-sonnet-4-6");

    expect(featureFlow.roles.code_review!.model).toBe("claude-opus-4-7");
    expect(featureFlow.roles.code_review!.reasoningHint).toBe("medium");

    // validate role is no longer registered on featureFlow (reverted).
    expect(featureFlow.roles.validate).toBeUndefined();
  });

  it("uses bypassPermissions everywhere with tool whitelists enforcing scope", () => {
    expect(featureFlow.roles.investigate!.permissionMode).toBe("bypassPermissions");
    expect(featureFlow.roles.investigate!.allowedTools).toEqual(["Read", "Grep", "Glob", "WebFetch"]);

    expect(featureFlow.roles.clarify!.permissionMode).toBe("bypassPermissions");
    expect(featureFlow.roles.clarify!.allowedTools).toEqual(["Read", "Grep", "Glob"]);

    expect(featureFlow.roles.plan!.permissionMode).toBe("bypassPermissions");
    // Plan role is JSON-only (no Edit/Write/Bash) — the orchestrator
    // renders task_plan.md from the parsed JSON. Mixing tool writes with
    // outputSchema mode tripped "non-JSON final text" failures.
    expect(featureFlow.roles.plan!.allowedTools).toEqual(["Read", "Grep", "Glob"]);

    expect(featureFlow.roles.implement!.permissionMode).toBe("bypassPermissions");
    expect(featureFlow.roles.implement!.allowedTools).toContain("Bash");

    expect(featureFlow.roles.code_review!.permissionMode).toBe("bypassPermissions");
    expect(featureFlow.roles.code_review!.allowedTools).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Bash",
    ]);
  });

  it("expectedArtifacts match the design", () => {
    expect(featureFlow.roles.investigate!.expectedArtifacts).toEqual([".plan/findings.md"]);
    expect(featureFlow.roles.clarify!.expectedArtifacts).toEqual([".plan/clarify.json"]);
    expect(featureFlow.roles.plan!.expectedArtifacts).toEqual([".plan/plan.json"]);
    expect(featureFlow.roles.implement!.expectedArtifacts).toEqual([
      ".handoff/implement_summary.md",
    ]);
    expect(featureFlow.roles.code_review!.expectedArtifacts).toEqual([]);
  });

  it("code-review carries the structured outputSchema for the fail loop", () => {
    expect(featureFlow.roles.code_review!.outputSchema).toBe(CODE_REVIEW_OUTPUT_SCHEMA);
    expect(CODE_REVIEW_OUTPUT_SCHEMA.required).toEqual(
      expect.arrayContaining([
        "passed",
        "summary",
        "issues",
        "acceptance_results",
        "phase_results",
      ]),
    );
  });

  it("systemPromptBuilder embeds the rendered context pack", () => {
    const fixture: ContextPackInput = {
      project: { name: "p", rootPath: "/p", defaultBaseRef: "main" },
      task: { title: "T", descriptionMd: "desc", status: "open" },
      jiraLinks: [],
      confluenceLinks: [],
      metaContexts: [],
      priorStepArtifacts: [],
      role: featureFlow.roles.investigate!,
    };
    const pack = buildContextPack(fixture);
    const prompt = featureFlow.roles.investigate!.systemPromptBuilder(pack);
    expect(prompt.includes(pack.markdown)).toBe(true);
    expect(prompt.includes("# Context")).toBe(true);
    expect(prompt.includes("Read, Grep, Glob, WebFetch")).toBe(true);
  });

  describe("Phase 32 — workflow prompt hardening", () => {
    function buildPrompt(roleKey: keyof typeof featureFlow.roles): string {
      const role = featureFlow.roles[roleKey]!;
      const fixture: ContextPackInput = {
        project: { name: "p", rootPath: "/p", defaultBaseRef: "main" },
        task: { title: "T", descriptionMd: "desc", status: "open" },
        jiraLinks: [],
        confluenceLinks: [],
        metaContexts: [],
        priorStepArtifacts: [],
        role,
      };
      const pack = buildContextPack(fixture);
      return role.systemPromptBuilder(pack);
    }

    it("planRole declares the Phase-36 structured-plan contract (JSON output, AC coverage, open_questions escape)", () => {
      const prompt = buildPrompt("plan");
      // JSON-is-the-contract framing.
      expect(prompt).toMatch(/outputSchema/);
      expect(prompt).toMatch(/task_summary/);
      expect(prompt).toMatch(/acceptance_criteria/);
      expect(prompt).toMatch(/covers_acceptance/);
      // Coverage rule.
      expect(prompt).toMatch(/coverage check|covers_acceptance.*at least/i);
      // open_questions is the don't-guess escape hatch (replaces Phase-32 "Scope insufficient").
      expect(prompt).toMatch(/open_questions/);
      expect(prompt).toMatch(/Do NOT guess/i);
      // Vague language is rejected.
      expect(prompt).toMatch(/TBD|vague/i);
      // task_plan.md is rendered server-side from the JSON; planner
      // doesn't write it.
      expect(prompt).toMatch(/orchestrator derives|server-side|don't write it/i);
    });

    it("implementRole forbids silent no-op and mandates the NO_CHANGES: signal", () => {
      const prompt = buildPrompt("implement");
      expect(prompt).toMatch(/Silent no-op .* forbidden/i);
      expect(prompt).toContain("NO_CHANGES:");
      expect(prompt).toContain(".handoff/clarification.md");
      // Honor planner-proposed defaults.
      expect(prompt).toMatch(/Honor the default|honor.*default/i);
    });

    it("codeReviewRole recognizes NO_CHANGES: as an intentional no-op and passes the session", () => {
      const prompt = buildPrompt("code_review");
      expect(prompt).toContain("NO_CHANGES:");
      expect(prompt).toMatch(/Intentional no-op/);
      // Verification evidence is scoped to phases that actually changed code.
      expect(prompt).toMatch(/only require evidence/i);
      // Phase 36/37 removed the "Scope insufficient" plan shape — the
      // open_questions[] auto-route to clarify replaced it. The
      // reviewer no longer needs that recognition (such plans never
      // reach review).
    });
  });

  describe("Phase 33 — clarify and validate roles", () => {
    function buildPrompt(roleKey: keyof typeof featureFlow.roles): string {
      const role = featureFlow.roles[roleKey]!;
      const fixture: ContextPackInput = {
        project: { name: "p", rootPath: "/p", defaultBaseRef: "main" },
        task: { title: "T", descriptionMd: "desc", status: "open" },
        jiraLinks: [],
        confluenceLinks: [],
        metaContexts: [],
        priorStepArtifacts: [],
        role,
      };
      const pack = buildContextPack(fixture);
      return role.systemPromptBuilder(pack);
    }

    it("clarifyRole prompt declares the structured all_clear / needs_input contract", () => {
      const prompt = buildPrompt("clarify");
      expect(prompt).toContain("all_clear");
      expect(prompt).toContain("needs_input");
      // Each question must carry a proposed default.
      expect(prompt).toMatch(/proposed default|default the user can accept/i);
      // Don't re-ask things already answered in clarification_answers.
      expect(prompt).toContain("clarification_answers");
    });

    it("clarifyRole carries a structured outputSchema with an enum status field", () => {
      const role = featureFlow.roles.clarify!;
      expect(role.outputSchema).toBeDefined();
      const schema = role.outputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const statusProp = props.status as { enum: string[] };
      expect(statusProp.enum).toEqual(["all_clear", "needs_input"]);
    });
  });

  describe("Phase 39 — code_review consumes plan.json + per-AC verdicts", () => {
    function buildPrompt(roleKey: keyof typeof featureFlow.roles): string {
      const role = featureFlow.roles[roleKey]!;
      const fixture: ContextPackInput = {
        project: { name: "p", rootPath: "/p", defaultBaseRef: "main" },
        task: { title: "T", descriptionMd: "desc", status: "open" },
        jiraLinks: [],
        confluenceLinks: [],
        metaContexts: [],
        priorStepArtifacts: [],
        role,
      };
      const pack = buildContextPack(fixture);
      return role.systemPromptBuilder(pack);
    }

    it("codeReviewRole prompt instructs reading plan.json and emitting per-AC + per-phase verdicts", () => {
      const prompt = buildPrompt("code_review");
      expect(prompt).toContain(".plan/plan.json");
      expect(prompt).toContain("acceptance_criteria");
      expect(prompt).toContain("acceptance_results");
      expect(prompt).toContain("phase_results");
      // Honest-at-the-per-AC-level rule.
      expect(prompt).toMatch(/be honest at the per-AC level|orchestrator routes/i);
    });

    it("codeReviewRole outputSchema requires acceptance_results + phase_results with id/passed/evidence shape", () => {
      const role = featureFlow.roles.code_review!;
      expect(role.outputSchema).toBeDefined();
      const schema = role.outputSchema as Record<string, unknown>;
      expect((schema.required as string[])).toEqual(
        expect.arrayContaining([
          "passed",
          "summary",
          "issues",
          "acceptance_results",
          "phase_results",
        ]),
      );
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const acItems = (props.acceptance_results as { items: Record<string, unknown> }).items;
      const acRequired = acItems.required as string[];
      expect(acRequired).toEqual(expect.arrayContaining(["id", "passed", "evidence"]));
      const acIdProp = (acItems.properties as Record<string, { pattern?: string }>).id;
      expect(acIdProp.pattern).toMatch(/AC/);
      const phaseItems = (props.phase_results as { items: Record<string, unknown> }).items;
      const phaseIdProp = (phaseItems.properties as Record<string, { pattern?: string }>).id;
      expect(phaseIdProp.pattern).toMatch(/P/);
    });
  });

  it("assertWorkflowDef rejects malformed defs", () => {
    expect(() =>
      assertWorkflowDef({
        id: "bad",
        steps: [
          { role: "investigate", ord: 0 },
          { role: "plan", ord: 0 }, // duplicate ord
        ],
        roles: featureFlow.roles,
      }),
    ).toThrow(/duplicate ord/);
  });
});
