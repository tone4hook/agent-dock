import React from "react";
import { ArrowLeft, Sparkles, Star, StarOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HaikuExploreDialog } from "@/components/HaikuExploreDialog";
import { Markdown } from "@/components/Markdown";
import { MetaContextEditor } from "@/components/MetaContextEditor";
import { TopBar } from "@/components/TopBar";
import {
  type JiraIssueDetail,
  getJiraIssue,
  saveJiraIssue,
  unsaveJiraIssue,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  navigate: Navigate;
  issueKey: string;
}

export function JiraDetailView({ navigate, issueKey }: Props) {
  const [detail, setDetail] = React.useState<JiraIssueDetail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exploreOpen, setExploreOpen] = React.useState(false);
  const [contextRefreshKey, setContextRefreshKey] = React.useState(0);

  React.useEffect(() => {
    void load();
  }, [issueKey]);

  async function load() {
    setError(null);
    try {
      setDetail(await getJiraIssue(issueKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleSave() {
    if (!detail) return;
    setBusy(true);
    try {
      if (detail.saved) {
        await unsaveJiraIssue(detail.key);
      } else {
        await saveJiraIssue(detail.key);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{issueKey}</span>
            {detail?.status ? <Badge>{detail.status}</Badge> : null}
          </span>
        }
        sub="Jira issue"
        right={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate({ view: "jira-search" })}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {detail?.saved ? (
              <Button variant="outline" size="sm" onClick={() => setExploreOpen(true)}>
                <Sparkles className="h-4 w-4" />
                Explore with Haiku
              </Button>
            ) : null}
            {detail ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={toggleSave}>
                {detail.saved ? (
                  <>
                    <StarOff className="h-4 w-4" />
                    Unsave
                  </>
                ) : (
                  <>
                    <Star className="h-4 w-4" />
                    Save locally
                  </>
                )}
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

        {detail ? (
          <>
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold">{detail.summary}</h2>
                <p className="text-xs text-muted-foreground">
                  reporter {detail.reporter ?? "—"} · assignee {detail.assignee ?? "—"} · updated{" "}
                  {new Date(detail.updated).toLocaleString()}
                </p>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-auto">
                  {detail.descriptionMd ? (
                    <Markdown content={detail.descriptionMd} />
                  ) : (
                    <p className="text-sm text-muted-foreground">(no description)</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold">Comments ({detail.comments.length})</h2>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No comments.</p>
                ) : (
                  detail.comments.map((c) => (
                    <div key={c.id} className="rounded-md border border-border bg-background p-3">
                      <p className="text-xs uppercase text-muted-foreground">
                        {c.author ?? "unknown"} · {new Date(c.createdAt).toLocaleString()}
                      </p>
                      <div className="mt-2">
                        <Markdown content={c.bodyMd} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                {detail.saved ? (
                  <MetaContextEditor
                    key={contextRefreshKey}
                    scopeType="jira"
                    scopeId={detail.key}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Save this issue locally to attach meta-context notes.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        </main>
      </div>
      {detail ? (
        <HaikuExploreDialog
          scopeType="jira"
          scopeId={detail.key}
          open={exploreOpen}
          onClose={() => setExploreOpen(false)}
          onSaved={() => setContextRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  );
}
