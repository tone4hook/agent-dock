import * as React from "react";
import { HelpCircle, Send } from "lucide-react";
import type { StepArtifact } from "@agent-dock/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useArtifactContent } from "@/lib/useArtifactContent";
import { submitClarificationAnswers, type ClarifyQuestion } from "@/lib/api";

interface Props {
  sessionId: string;
  artifacts: StepArtifact[];
  /** Parent's refresh callback — called after a successful submit so the
   *  session-detail polling rail picks up the new state without a wait. */
  onSubmitted: () => void;
}

/**
 * Phase 33: surfaced when `session.status === "awaiting_clarification"`.
 * Reads the latest `clarify_questions` step_artifact and renders one
 * Textarea per question. Each question's `default` is pre-filled so the
 * user can usually accept all defaults wholesale and move on.
 */
export function ClarificationForm({ sessionId, artifacts, onSubmitted }: Props) {
  const latest = latestClarifyArtifact(artifacts);
  const { content, error: fetchError } = useArtifactContent(sessionId, latest);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Source the question list from the full artifact content first; fall
  // back to the truncated preview for the initial render so the form
  // appears immediately while the fetch is in flight.
  const questions = React.useMemo<ClarifyQuestion[]>(() => {
    return parseQuestions(content) ?? parseQuestions(latest?.preview ?? null) ?? [];
  }, [content, latest?.preview]);

  // Seed each question's draft answer with its proposed default the
  // first time we see it. Subsequent edits stick.
  React.useEffect(() => {
    setAnswers((cur) => {
      let next = cur;
      for (const q of questions) {
        if (!(q.id in next) && typeof q.default === "string") {
          if (next === cur) next = { ...cur };
          next[q.id] = q.default;
        }
      }
      return next;
    });
  }, [questions]);

  if (!latest) return null;

  if (questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold">Clarification needed</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The clarify role flagged this task as needing more input but the
            questions could not be parsed. Inspect <code>.plan/clarify.json</code>
            in the worktree.
          </p>
          {fetchError ? <p className="text-xs text-red-700">{fetchError}</p> : null}
        </CardContent>
      </Card>
    );
  }

  const allAnswered = questions.every(
    (q) => typeof answers[q.id] === "string" && answers[q.id].trim().length > 0,
  );

  async function handleSubmit() {
    if (!allAnswered || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      // Snapshot answers in the closure so a re-render mid-submit doesn't
      // re-pluck a different value off the form state.
      const trimmed: Record<string, string> = {};
      for (const q of questions) trimmed[q.id] = (answers[q.id] ?? "").trim();
      await submitClarificationAnswers(sessionId, trimmed);
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-semibold">Clarification needed</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The planner can't proceed without these answers. Defaults are pre-filled
          where the role had a confident guess; edit any field that needs a
          different value, then submit.
        </p>
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <label className="text-sm font-medium">{q.text}</label>
            <Textarea
              value={answers[q.id] ?? ""}
              onChange={(e) =>
                setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))
              }
              rows={2}
              placeholder={q.default ?? "Your answer…"}
            />
            {q.default && answers[q.id] === q.default ? (
              <p className="text-[11px] text-muted-foreground">
                using proposed default
              </p>
            ) : null}
          </div>
        ))}
        {submitError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={!allAnswered || busy} onClick={() => void handleSubmit()}>
            <Send className="h-4 w-4" />
            {busy ? "Submitting…" : "Submit answers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function latestClarifyArtifact(artifacts: StepArtifact[]): StepArtifact | undefined {
  const matches = artifacts.filter((a) => a.kind === "clarify_questions");
  if (matches.length === 0) return undefined;
  return matches.reduce((acc, a) => (a.createdAt > acc.createdAt ? a : acc));
}

function parseQuestions(json: string | null | undefined): ClarifyQuestion[] | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  // Accept either shape:
  //  - a bare array of {id, text, default}     (artifact preview path,
  //    written by coordinator's plan→clarify auto-route)
  //  - the full clarify verdict {status, questions[]}   (artifact file
  //    path, written by the outputSchema-driven artifact materialisation
  //    when the clarify role itself ran with status="needs_input").
  let arr: unknown;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { questions?: unknown }).questions)
  ) {
    arr = (parsed as { questions: unknown[] }).questions;
  } else {
    return null;
  }
  const out: ClarifyQuestion[] = [];
  for (const row of arr as unknown[]) {
    if (
      row &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string" &&
      typeof (row as { text?: unknown }).text === "string"
    ) {
      const r = row as { id: string; text: string; default?: unknown };
      out.push({
        id: r.id,
        text: r.text,
        default: typeof r.default === "string" ? r.default : undefined,
      });
    }
  }
  return out.length > 0 ? out : null;
}
