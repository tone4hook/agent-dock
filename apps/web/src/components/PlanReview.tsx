import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { Session, StepArtifact } from "@agent-dock/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { approveSession, rejectSession } from "@/lib/api";
import { useArtifactContent } from "@/lib/useArtifactContent";
import {
  PlanApprovalCard,
  parsePlanArtifactBody,
} from "@/components/PlanApprovalCard";
import { PlanGapsPanel, parseGapsBody } from "@/components/PlanGapsPanel";

interface Props {
  session: Session;
  artifacts: StepArtifact[];
  onChanged: () => void;
  /**
   * Optional pre-fill for the rejection textarea. ReviewIssues uses
   * this to wire its "Use review feedback as rejection" button so the
   * user goes from "code review failed" → re-plan with structured
   * feedback in one click.
   */
  initialRejectionDraft?: string | null;
}

export function PlanReview({ session, artifacts, onChanged, initialRejectionDraft }: Props) {
  const planArtifact = artifacts.find((a) => a.kind === "plan");
  // Phase 38: prefer the structured plan artifact (JSON) for rendering.
  // Fall back to the markdown `plan` artifact when JSON is missing or
  // unparseable (older sessions, runner without outputSchema, etc).
  const planStructuredArtifact = artifacts.find(
    (a) => a.kind === "plan_structured",
  );
  const planGapsArtifact = artifacts.find((a) => a.kind === "plan_gaps");
  const findings = artifacts.find((a) => a.kind === "findings");
  const planFull = useArtifactContent(session.id, planArtifact);
  const planStructuredFull = useArtifactContent(
    session.id,
    planStructuredArtifact,
  );
  const findingsFull = useArtifactContent(session.id, findings);

  const structuredPlan = parsePlanArtifactBody(
    planStructuredFull.content ?? planStructuredArtifact?.preview ?? null,
  );
  const gaps = parseGapsBody(planGapsArtifact?.preview ?? null);
  const hasGaps = gaps.length > 0;

  const [comment, setComment] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // When ReviewIssues hands us a draft (e.g. after a code-review fail),
  // pop the rejection panel open with the draft pre-filled. The user
  // can edit it before sending. We depend only on the draft string so
  // toggling the panel manually after this effect won't re-pop it.
  React.useEffect(() => {
    if (initialRejectionDraft) {
      setComment(initialRejectionDraft);
      setShowReject(true);
    }
  }, [initialRejectionDraft]);

  const enabled = session.status === "awaiting_approval";
  const approveDisabled = !enabled || busy || hasGaps;

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveSession(session.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await rejectSession(session.id, comment.trim());
      setComment("");
      setShowReject(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">Plan review</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {findings ? (
          <details className="rounded-md border border-border bg-background p-3">
            <summary className="cursor-pointer text-xs uppercase text-muted-foreground">
              Findings ({findings.filePath})
            </summary>
            {findingsFull.error ? (
              <p className="mt-2 text-xs text-red-700">{findingsFull.error}</p>
            ) : null}
            <pre className="mt-2 max-h-[40rem] overflow-auto whitespace-pre-wrap text-xs">
              {findingsFull.content ?? findings.preview ?? "(loading…)"}
            </pre>
          </details>
        ) : null}

        {structuredPlan ? (
          <PlanApprovalCard plan={structuredPlan} />
        ) : (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase text-muted-foreground">Plan</div>
              {planArtifact ? (
                <code className="text-xs text-muted-foreground">{planArtifact.filePath}</code>
              ) : null}
            </div>
            {planArtifact ? (
              <>
                {planFull.error ? (
                  <p className="mt-2 text-xs text-red-700">{planFull.error}</p>
                ) : null}
                <pre className="mt-2 max-h-[40rem] overflow-auto whitespace-pre-wrap text-sm">
                  {planFull.content ?? planArtifact.preview ?? "(loading…)"}
                </pre>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                The planner step has not produced an artifact yet.
              </p>
            )}
          </div>
        )}

        {hasGaps ? (
          <PlanGapsPanel
            gaps={gaps}
            onPrefillReject={(text) => {
              setComment(text);
              setShowReject(true);
            }}
          />
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {showReject ? (
          <div className="space-y-2 rounded-md border border-border bg-background p-3">
            <Textarea
              placeholder="What does the plan need to change? This message becomes the planner's input on the next iteration."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowReject(false);
                  setComment("");
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy || !comment.trim()} onClick={handleReject}>
                Send rejection
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => setShowReject(true)}
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button
              disabled={approveDisabled}
              onClick={handleApprove}
              title={
                hasGaps
                  ? `Plan has ${gaps.length} gap${gaps.length === 1 ? "" : "s"} — use Reject to send them back to the planner.`
                  : undefined
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve
            </Button>
          </div>
        )}
        {!enabled ? (
          <p className="text-xs text-muted-foreground">
            Approve / Reject is enabled when the session is{" "}
            <code>awaiting_approval</code>.
          </p>
        ) : hasGaps ? (
          <p className="text-xs text-amber-700">
            Approve is disabled while the plan has unresolved gaps.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
