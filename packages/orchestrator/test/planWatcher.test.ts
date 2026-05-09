import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanWatcher, type PlanWatcherEvent } from "../src/planWatcher.js";

let tmp: string;
let watcher: PlanWatcher | null;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ad-pw-"));
  mkdirSync(join(tmp, ".plan"), { recursive: true });
  mkdirSync(join(tmp, ".handoff"), { recursive: true });
  watcher = null;
});

afterEach(async () => {
  if (watcher) await watcher.stop();
  rmSync(tmp, { recursive: true, force: true });
});

async function captureEvents(
  worktreePath: string,
  fn: () => Promise<void>,
  expected: number,
): Promise<PlanWatcherEvent[]> {
  const events: PlanWatcherEvent[] = [];
  const w = new PlanWatcher({
    worktreePath,
    onEvent: (e) => events.push(e),
    stabilityMs: 50,
  });
  watcher = w;
  await w.start();
  // Give the polling watcher one interval boundary before the first
  // write so latency assertions do not depend on scheduler timing.
  await new Promise((r) => setTimeout(r, 100));
  await fn();
  // Wait until we see the expected number of events or timeout.
  await waitFor(() => events.length >= expected, 5000);
  return events;
}

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("PlanWatcher", () => {
  it("emits plan_updated when .plan/task_plan.md changes", async () => {
    const events = await captureEvents(
      tmp,
      async () => {
        writeFileSync(join(tmp, ".plan", "task_plan.md"), "# Plan\n- [ ] Phase 1\n");
      },
      1,
    );
    expect(events.some((e) => e.kind === "plan_updated" && e.relPath === ".plan/task_plan.md")).toBe(true);
    const planEvent = events.find((e) => e.kind === "plan_updated");
    expect(planEvent?.preview.includes("Phase 1")).toBe(true);
  });

  it("emits findings_updated when .plan/findings.md changes", async () => {
    const events = await captureEvents(
      tmp,
      async () => {
        writeFileSync(join(tmp, ".plan", "findings.md"), "# Findings\n");
      },
      1,
    );
    expect(events.some((e) => e.kind === "findings_updated")).toBe(true);
  });

  it("emits handoff_updated and parses JSON for .handoff/*.json", async () => {
    const events = await captureEvents(
      tmp,
      async () => {
        writeFileSync(
          join(tmp, ".handoff", "review.json"),
          JSON.stringify({ passed: false, summary: "needs work" }),
        );
      },
      1,
    );
    const evt = events.find((e) => e.kind === "handoff_updated");
    expect(evt?.relPath).toBe(".handoff/review.json");
    expect((evt?.parsed as { passed?: boolean })?.passed).toBe(false);
    expect((evt?.parsed as { summary?: string })?.summary).toBe("needs work");
  });

  it("ignores files outside .plan/ and .handoff/", async () => {
    const events = await captureEvents(
      tmp,
      async () => {
        writeFileSync(join(tmp, "README.md"), "hello");
        // Wait briefly to make sure noise gets a chance to surface.
        await new Promise((r) => setTimeout(r, 200));
      },
      0,
    );
    expect(events).toHaveLength(0);
  });

  it("event-to-emit latency stays under 500ms", async () => {
    let firstAt = 0;
    const w = new PlanWatcher({
      worktreePath: tmp,
      onEvent: () => {
        if (!firstAt) firstAt = Date.now();
      },
      stabilityMs: 50,
    });
    watcher = w;
    await w.start();
    // Give the polling watcher one interval boundary before the first
    // write so this measures detection latency, not startup timing.
    await new Promise((r) => setTimeout(r, 100));
    const writeAt = Date.now();
    writeFileSync(join(tmp, ".plan", "task_plan.md"), "# plan\n");
    await waitFor(() => firstAt > 0, 3000);
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt - writeAt).toBeLessThan(500);
  });
});
