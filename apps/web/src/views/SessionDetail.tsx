import React from "react";
import { ArrowLeft, GitBranch, Pause, Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ClarificationForm } from "@/components/ClarificationForm";
import { PlanReview } from "@/components/PlanReview";
import { ReviewIssues } from "@/components/ReviewIssues";
import { SessionEventStream } from "@/components/SessionEventStream";
import { SessionFailedCard } from "@/components/SessionFailedCard";
import { TopBar } from "@/components/TopBar";
import {
  cancelSession,
  getSession,
  pauseSession,
  resumeSession,
  startSession,
  type SessionDetail,
} from "@/lib/api";
import type { Navigate, Route } from "@/lib/router";

interface Props {
  navigate: Navigate;
  sessionId: string;
  /** Optional history-aware back. If omitted, the view falls back to navigating to the task page. */
  onBack?: (fallback: Route) => void;
}

export function SessionDetailView({ navigate, sessionId, onBack }: Props) {
  const [detail, setDetail] = React.useState<SessionDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Set when ReviewIssues forwards a verdict-as-feedback string;
  // PlanReview pops its rejection panel pre-filled with this draft.
  const [rejectionDraft, setRejectionDraft] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setDetail(await getSession(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Periodic refresh while running so the artifact previews catch up
  // (the SSE stream covers events but artifacts are pulled separately).
  React.useEffect(() => {
    const status = detail?.session.status;
    if (
      status === "running" ||
      status === "awaiting_approval" ||
      status === "awaiting_clarification" ||
      status === "paused"
    ) {
      const t = setInterval(() => void refresh(), 3000);
      return () => clearInterval(t);
    }
  }, [detail?.session.status, refresh]);

  async function handleCancel() {
    setBusy(true);
    try {
      await cancelSession(sessionId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    setBusy(true);
    try {
      await pauseSession(sessionId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    try {
      await resumeSession(sessionId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFork() {
    if (!detail?.session.branch) return;
    setBusy(true);
    setError(null);
    try {
      const r = await startSession(detail.session.taskId, {
        baseRefOverride: detail.session.branch,
      });
      navigate({ view: "session-detail", sessionId: r.sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="min-h-screen p-8 text-sm text-muted-foreground">
        {error ?? "Loading session…"}
      </div>
    );
  }

  const { session, steps, artifacts } = detail;
  const failureInfo = detail.failureInfo ?? null;
  const sortedSteps = [...steps].sort((a, b) => a.ord - b.ord);

  return (
    <>
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <span>Session</span>
            <Badge>{session.status}</Badge>
          </span>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const fallback: Route = { view: "task-detail", taskId: session.taskId };
                if (onBack) onBack(fallback);
                else navigate(fallback);
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {session.status === "running" ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={handlePause}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            ) : null}
            {session.status === "paused" ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={handleResume}>
                <Play className="h-4 w-4" />
                Resume
              </Button>
            ) : null}
            {session.status === "running" ||
            session.status === "awaiting_approval" ||
            session.status === "awaiting_clarification" ||
            session.status === "paused" ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={handleCancel}>
                <Square className="h-4 w-4" />
                Cancel
              </Button>
            ) : null}
            {/*
              Fork: clone a fresh session whose worktree branches off this
              session's branch tip. Available whenever the session is in a
              terminal/review state and a branch exists. Lets the user
              continue work from any session — including ones that died
              before code review (no review_result artifact) where the
              ReviewIssues card never renders.
            */}
            {session.branch &&
            (session.status === "failed" ||
              session.status === "cancelled" ||
              session.status === "completed" ||
              session.status === "awaiting_approval") ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleFork()}
                title={`Start a new session forked from ${session.branch}.`}
              >
                <GitBranch className="h-4 w-4" />
                Fork to new session
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex-1 overflow-auto">
        <main className="mx-auto max-w-5xl space-y-4 px-5 py-5">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Worktree</h2>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>
              <span className="text-xs uppercase">Path</span>
              <div className="font-mono text-foreground">{session.worktreePath}</div>
            </div>
            <div>
              <span className="text-xs uppercase">Branch</span>
              <div className="font-mono text-foreground">{session.branch}</div>
            </div>
            <div>
              <span className="text-xs uppercase">Base ref</span>
              <div className="font-mono text-foreground">{session.baseRef}</div>
            </div>
          </CardContent>
        </Card>

        {session.status === "awaiting_clarification" ? (
          <ClarificationForm
            sessionId={sessionId}
            artifacts={artifacts}
            onSubmitted={() => void refresh()}
          />
        ) : null}

        {session.status === "failed" ? (
          <SessionFailedCard
            session={session}
            failureInfo={failureInfo}
            navigate={navigate}
            onChanged={() => void refresh()}
          />
        ) : null}

        <ReviewIssues
          sessionId={sessionId}
          taskId={session.taskId}
          branch={session.branch}
          artifacts={artifacts}
          onUseAsRejection={
            session.status === "awaiting_approval" ? setRejectionDraft : undefined
          }
          navigate={navigate}
        />

        {session.status === "awaiting_clarification" ? null : (
          <PlanReview
            session={session}
            artifacts={artifacts}
            onChanged={() => {
              setRejectionDraft(null);
              void refresh();
            }}
            initialRejectionDraft={rejectionDraft}
          />
        )}

        <SessionEventStream sessionId={sessionId} steps={sortedSteps} onTick={refresh} />
        </main>
      </div>
    </>
  );
}

