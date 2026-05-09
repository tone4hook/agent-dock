import * as React from "react";
import {
  AlertCircle,
  ArrowRightCircle,
  Bookmark,
  CheckCircle2,
  GitBranch,
  XCircle,
} from "lucide-react";
import type { StepArtifact } from "@agent-dock/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useArtifactContent } from "@/lib/useArtifactContent";
import { createMetaContext, startSession } from "@/lib/api";
import type { Navigate } from "@/lib/router";

export interface ReviewIssue {
  severity: "blocker" | "major" | "minor";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewVerdict {
  passed: boolean;
  summary: string;
  issues: ReviewIssue[];
}

interface Props {
  sessionId: string;
  /** Owning task; needed for "Save verdict to task" + "Start new session". */
  taskId: string;
  /** Failed session's branch — used as baseRef for the forked new session. */
  branch: string | null;
  artifacts: StepArtifact[];
  /**
   * Same-session continuation. PlanReview pops its rejection panel
   * pre-filled with the formatted verdict. Only available while the
   * session is awaiting_approval — outside of that, the new branch-fork
   * action is the next step.
   */
  onUseAsRejection?: (text: string) => void;
  navigate: Navigate;
}

const severityVariant: Record<ReviewIssue["severity"], string> = {
  blocker: "bg-red-100 text-red-800 border-red-300",
  major: "bg-orange-100 text-orange-800 border-orange-300",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-300",
};

export function ReviewIssues({
  sessionId,
  taskId,
  branch,
  artifacts,
  onUseAsRejection,
  navigate,
}: Props) {
  const latest = latestReviewArtifact(artifacts);
  const { content, error } = useArtifactContent(sessionId, latest);
  const [savedToTask, setSavedToTask] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (!latest) return null;

  const verdict = parseVerdict(content) ?? parseVerdict(latest.preview);

  if (!verdict) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold">Code review</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A review_result artifact exists but its JSON could not be parsed.
          </p>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          <details className="rounded-md border border-border bg-background p-3">
            <summary className="cursor-pointer text-xs uppercase text-muted-foreground">
              Raw payload
            </summary>
            <pre className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap text-xs">
              {content ?? latest.preview ?? "(empty)"}
            </pre>
          </details>
        </CardContent>
      </Card>
    );
  }

  async function handleSaveToTask() {
    if (!verdict || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await createMetaContext({
        scopeType: "task",
        scopeId: taskId,
        kind: "review_feedback",
        bodyMd: formatVerdictAsRejection(verdict),
      });
      setSavedToTask(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleForkNewSession() {
    if (!branch || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await startSession(taskId, { baseRefOverride: branch });
      navigate({ view: "session-detail", sessionId: r.sessionId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {verdict.passed ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            <h2 className="text-sm font-semibold">
              Code review — {verdict.passed ? "passed" : "failed"}
            </h2>
          </div>
          {!verdict.passed ? (
            <div className="flex flex-wrap items-center gap-2">
              {onUseAsRejection ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUseAsRejection(formatVerdictAsRejection(verdict))}
                >
                  <ArrowRightCircle className="h-4 w-4" />
                  Use as rejection feedback
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || savedToTask}
                onClick={() => void handleSaveToTask()}
                title="Persist this verdict on the task; future sessions auto-pick it up via the ContextPack."
              >
                <Bookmark className="h-4 w-4" />
                {savedToTask ? "Saved to task" : "Save verdict to task"}
              </Button>
              {branch ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleForkNewSession()}
                  title={`Fork a new session off ${branch} so the implementer's commits carry over.`}
                >
                  <GitBranch className="h-4 w-4" />
                  Start new session from this branch
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{verdict.summary}</p>
        {verdict.issues.length > 0 ? (
          <ul className="space-y-2">
            {verdict.issues.map((issue, idx) => (
              <li
                key={`${issue.file}:${issue.line ?? "?"}:${idx}`}
                className="rounded-md border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2">
                  <Badge className={`border ${severityVariant[issue.severity]}`}>
                    {issue.severity}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {issue.file}
                    {typeof issue.line === "number" ? `:${issue.line}` : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm">{issue.message}</p>
                {issue.suggestion ? (
                  <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{issue.suggestion}</span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No issues raised.</p>
        )}
        {actionError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function latestReviewArtifact(artifacts: StepArtifact[]): StepArtifact | undefined {
  const reviews = artifacts.filter((a) => a.kind === "review_result");
  if (reviews.length === 0) return undefined;
  return reviews.reduce((acc, a) => (a.createdAt > acc.createdAt ? a : acc));
}

function parseVerdict(json: string | null | undefined): ReviewVerdict | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ReviewVerdict>;
    if (typeof parsed.passed !== "boolean" || typeof parsed.summary !== "string") {
      return null;
    }
    return {
      passed: parsed.passed,
      summary: parsed.summary,
      issues: Array.isArray(parsed.issues) ? (parsed.issues as ReviewIssue[]) : [],
    };
  } catch {
    return null;
  }
}

function formatVerdictAsRejection(v: ReviewVerdict): string {
  const lines = [
    `Code review failed: ${v.summary}`,
    "",
    "Address these issues in the next plan iteration:",
  ];
  for (const issue of v.issues) {
    const loc = `${issue.file}${typeof issue.line === "number" ? `:${issue.line}` : ""}`;
    lines.push(`- [${issue.severity}] ${loc} — ${issue.message}`);
    if (issue.suggestion) lines.push(`    suggestion: ${issue.suggestion}`);
  }
  return lines.join("\n");
}
