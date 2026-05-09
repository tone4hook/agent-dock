import * as React from "react";
import { AlertCircle, GitBranch, RotateCw, Square } from "lucide-react";
import type { Session } from "@agent-dock/shared";
import { cancelSession, retryStep, startSession, type SessionFailureInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Navigate } from "@/lib/router";

interface Props {
  session: Session;
  failureInfo: SessionFailureInfo | null;
  navigate: Navigate;
  onChanged: () => void;
}

/**
 * Phase 34: visible diagnostic + recovery buttons for any failed
 * session.
 */
export function SessionFailedCard({
  session,
  failureInfo,
  navigate,
  onChanged,
}: Props) {
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (session.status !== "failed") return null;

  async function handleRetry() {
    if (busy || !failureInfo) return;
    setBusy(true);
    setActionError(null);
    try {
      await retryStep(session.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFork() {
    if (busy || !session.branch) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await startSession(session.taskId, { baseRefOverride: session.branch });
      navigate({ view: "session-detail", sessionId: r.sessionId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await cancelSession(session.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const role = failureInfo?.role ?? "unknown";
  const errorMessage = failureInfo?.errorMessage ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-semibold">
            Session failed at <span className="font-mono">{role}</span> step
          </h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            No error message recorded. Inspect the step events below for
            details.
          </p>
        )}
        {errorMessage === "plan role did not produce plan.json" ? (
          <p className="text-xs text-muted-foreground">
            The plan step did not emit a structured plan.{" "}
            <strong>Retry step</strong> usually fixes this.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          <strong>Retry step</strong> re-runs the same step in this session
          (best for transient errors). <strong>Fork to new session</strong>{" "}
          starts a fresh session forked off this branch — preserves any
          implementer commits already on disk.
        </p>
        {actionError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !failureInfo}
            onClick={() => void handleRetry()}
          >
            <RotateCw className="h-4 w-4" />
            Retry step
          </Button>
          {session.branch ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleFork()}
            >
              <GitBranch className="h-4 w-4" />
              Fork to new session
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleCancel()}
            title="Mark the session cancelled and stop further work."
          >
            <Square className="h-4 w-4" />
            Cancel cleanup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
