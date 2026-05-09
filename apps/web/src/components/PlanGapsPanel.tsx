import React from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  gaps: string[];
  /**
   * Called once when this panel mounts (or when the gap list changes)
   * with a formatted prefill block. PlanReview routes this to the
   * existing Reject textarea so the user's gap-aware rejection prompt
   * is one click away.
   */
  onPrefillReject: (text: string) => void;
}

/**
 * Phase 38 — gaps panel. Renders the orchestrator's `plan_gaps`
 * artifact (markdown bullet list of Zod errors) and emits a one-shot
 * prefill so PlanReview can pop the Reject textarea pre-filled with:
 *
 *   Address these gaps:
 *   - <gap1>
 *   - <gap2>
 *
 *   User additions:
 */
export function PlanGapsPanel({ gaps, onPrefillReject }: Props) {
  // Re-fire when the gap list itself changes (re-run produced new
  // errors). React strict mode double-invokes effects in dev — the
  // user-facing effect is idempotent: PlanReview replaces the textarea
  // contents, so a duplicate call is harmless.
  const key = gaps.join("\n");
  React.useEffect(() => {
    if (gaps.length === 0) return;
    const block = [
      "Address these gaps:",
      ...gaps.map((g) => `- ${g}`),
      "",
      "User additions:",
      "",
    ].join("\n");
    onPrefillReject(block);
    // Intentionally not depending on onPrefillReject — it's a setState
    // setter from PlanReview and doesn't change identity meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (gaps.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4" />
        Plan has {gaps.length} gap{gaps.length === 1 ? "" : "s"}
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {gaps.map((g, i) => (
          <li key={i} className="font-mono text-xs leading-relaxed">
            {g}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        Use <strong>Reject</strong> to send these back to the planner — the
        textarea is pre-filled.
      </p>
    </div>
  );
}

/**
 * Splits the orchestrator's `plan_gaps` markdown body (`- gap1\n- gap2`)
 * back into a string array. Lenient — strips leading dashes/whitespace.
 */
export function parseGapsBody(body: string | null | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}
