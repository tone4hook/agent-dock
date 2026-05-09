import { Badge } from "@/components/ui/badge";

export interface PlanArtifactView {
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
  out_of_scope: string[];
  open_questions: string[];
}

/**
 * Phase 38 — structured plan renderer. Pure presentation: no buttons,
 * no fetch, no state. PlanReview hosts it inside the existing approval
 * card so Approve/Reject + Reject-with-prompt continue to live in one
 * place. Falls back to a markdown <pre> in PlanReview when the JSON
 * artifact is missing or unparseable.
 */
export function PlanApprovalCard({ plan }: { plan: PlanArtifactView }) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-background p-4">
      <div>
        <div className="text-xs uppercase text-muted-foreground">Task summary</div>
        <p className="mt-1 text-sm">{plan.task_summary}</p>
      </div>

      <div>
        <div className="text-xs uppercase text-muted-foreground">Acceptance criteria</div>
        <ul className="mt-2 space-y-1.5">
          {plan.acceptance_criteria.map((ac) => (
            <li key={ac.id} className="flex gap-2 text-sm">
              <Badge className="font-mono">
                {ac.id}
              </Badge>
              <span>{ac.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-xs uppercase text-muted-foreground">Phases</div>
        <ul className="mt-2 space-y-3">
          {plan.phases.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-border bg-card/40 p-3"
            >
              <div className="flex items-center gap-2">
                <Badge className="font-mono">
                  {p.id}
                </Badge>
                <span className="font-semibold">{p.title}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{p.goal}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Files:</span>
                {p.files.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {f}
                  </code>
                ))}
              </div>
              <div className="mt-2 text-xs">
                <span className="text-muted-foreground">Done when:</span>{" "}
                <span>{p.done_when}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Covers:</span>
                {p.covers_acceptance.map((id) => (
                  <Badge key={id} className="font-mono text-[10px]">
                    {id}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {plan.out_of_scope.length > 0 ? (
        <div>
          <div className="text-xs uppercase text-muted-foreground">Out of scope</div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {plan.out_of_scope.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.open_questions.length > 0 ? (
        <div>
          <div className="text-xs uppercase text-amber-700">
            Open questions (planner could not resolve)
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
            {plan.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Best-effort parse of a `plan_structured` artifact body. Returns null
 * if the body is missing or not valid JSON conforming to the loose
 * shape PlanApprovalCard needs. PlanReview falls back to the markdown
 * <pre> render when this returns null.
 */
export function parsePlanArtifactBody(
  body: string | null | undefined,
): PlanArtifactView | null {
  if (!body) return null;
  try {
    const obj = JSON.parse(body) as Partial<PlanArtifactView>;
    if (
      typeof obj.task_summary === "string" &&
      Array.isArray(obj.acceptance_criteria) &&
      Array.isArray(obj.phases) &&
      Array.isArray(obj.open_questions ?? []) &&
      Array.isArray(obj.out_of_scope ?? [])
    ) {
      return {
        task_summary: obj.task_summary,
        acceptance_criteria: obj.acceptance_criteria,
        phases: obj.phases,
        open_questions: obj.open_questions ?? [],
        out_of_scope: obj.out_of_scope ?? [],
      };
    }
  } catch {
    return null;
  }
  return null;
}
