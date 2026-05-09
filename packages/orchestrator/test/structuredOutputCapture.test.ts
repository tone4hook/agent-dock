import { describe, expect, it } from "vitest";
import {
  errorMessageFromEvent,
  extractStructuredOutput,
  isStructuredOutputToolName,
  structuredOutputFromEvent,
} from "@agent-dock/agents";

/**
 * Pure-helper coverage for the structured-output capture logic that
 * SdkStepRunner uses. Lives here because the agents package has no
 * vitest harness yet, and the orchestrator workspace already imports
 * @agent-dock/agents — so the tests run in CI without setup.
 *
 * These tests guard against the regression that motivated this fix:
 * headless Claude Code, when run with --json-schema, can emit the
 * structured payload as a synthetic StructuredOutput tool_use whose
 * args carry the JSON. Earlier code only inspected message text and
 * produced "outputSchema role returned non-JSON final text" failures.
 */
describe("isStructuredOutputToolName", () => {
  it("matches 'StructuredOutput' verbatim", () => {
    expect(isStructuredOutputToolName("StructuredOutput")).toBe(true);
  });
  it("is case-insensitive (defensive against CLI rename)", () => {
    expect(isStructuredOutputToolName("structuredoutput")).toBe(true);
    expect(isStructuredOutputToolName("STRUCTUREDOUTPUT")).toBe(true);
  });
  it("matches when the name embeds the token", () => {
    // Hypothetical future namespacing.
    expect(isStructuredOutputToolName("claude.StructuredOutput")).toBe(true);
  });
  it("rejects unrelated tool names", () => {
    expect(isStructuredOutputToolName("Read")).toBe(false);
    expect(isStructuredOutputToolName("Edit")).toBe(false);
    expect(isStructuredOutputToolName("Write")).toBe(false);
    expect(isStructuredOutputToolName("Bash")).toBe(false);
  });
});

describe("extractStructuredOutput", () => {
  it("returns the tool-args JSON when present (canonical path — modern Claude with --json-schema)", () => {
    const args = { task_summary: "x", phases: [] };
    const result = extractStructuredOutput(args, "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json).toBe(args);
  });

  it("prefers tool-args over text even when finalText is non-empty (text is just preamble)", () => {
    const args = { canonical: true };
    const result = extractStructuredOutput(args, "Here's my plan...");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json).toEqual({ canonical: true });
  });

  it("falls back to JSON.parse(finalText) when tool-args is absent (older Claude / non-tool path)", () => {
    const result = extractStructuredOutput(undefined, '{"hello":"world"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json).toEqual({ hello: "world" });
  });

  it("reports 'non-JSON final text' when neither tool-args nor parseable text exist", () => {
    const result = extractStructuredOutput(
      undefined,
      "Sure, here's the plan in markdown form: # Plan",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/non-JSON final text/);
    }
  });

  it("reports 'no structured output' when both tool-args and finalText are empty (the user's reported failure mode)", () => {
    const result = extractStructuredOutput(undefined, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/no structured output/);
    }
  });

  it("treats whitespace-only finalText as empty (edge case)", () => {
    const result = extractStructuredOutput(undefined, "   \n  \t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/no structured output/);
    }
  });

  it("preserves null tool-args (null is a valid JSON value, distinct from undefined)", () => {
    const result = extractStructuredOutput(null, "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json).toBe(null);
  });
});

describe("structuredOutputFromEvent", () => {
  it("extracts structured output from the final result/done originalItem shape", () => {
    const structured = { task_summary: "valid plan", phases: [] };
    const event = {
      type: "done",
      provider: "claude",
      originalItem: {
        type: "result",
        subtype: "success",
        result: "",
        structured_output: structured,
      },
    };

    expect(structuredOutputFromEvent(event)).toBe(structured);
  });

  it("extracts structured output from top-level and extra fallback shapes", () => {
    const topLevel = { passed: true };
    expect(structuredOutputFromEvent({ structured_output: topLevel })).toBe(
      topLevel,
    );

    const extra = { passed: false };
    expect(
      structuredOutputFromEvent({
        type: "done",
        extra: { originalItem: { structured_output: extra } },
      }),
    ).toBe(extra);
  });
});

describe("errorMessageFromEvent", () => {
  it("extracts Claude stream error messages so CLI failures become failed steps", () => {
    expect(
      errorMessageFromEvent({
        type: "error",
        provider: "claude",
        message: "Not logged in · Please run /login",
        code: "authentication_failed",
      }),
    ).toBe("Not logged in · Please run /login");
  });

  it("falls back to the error code when the message is missing", () => {
    expect(
      errorMessageFromEvent({
        type: "error",
        provider: "claude",
        code: "authentication_failed",
      }),
    ).toBe("authentication_failed");
  });
});
