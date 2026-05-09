import React from "react";
import type { StepArtifact } from "@agent-dock/shared";
import { getArtifactContent } from "./api";

/**
 * Pulls the full text for an artifact (the DB row only stores a
 * truncated `preview`). Re-fetches when the artifact id OR its
 * `createdAt` changes — `createdAt` rotates when a step re-runs (e.g.
 * plan rejection or code-review fail loop), so this catches the second
 * iteration even if the artifact id stays the same row conceptually.
 */
export function useArtifactContent(
  sessionId: string,
  artifact: StepArtifact | undefined,
) {
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!artifact) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void getArtifactContent(sessionId, artifact.id)
      .then((r) => {
        if (!cancelled) setContent(r.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, artifact?.id, artifact?.createdAt]);
  return { content, error };
}
