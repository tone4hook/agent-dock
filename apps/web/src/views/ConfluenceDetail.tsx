import React from "react";
import { ArrowLeft, Sparkles, Star, StarOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HaikuExploreDialog } from "@/components/HaikuExploreDialog";
import { Markdown } from "@/components/Markdown";
import { MetaContextEditor } from "@/components/MetaContextEditor";
import { TopBar } from "@/components/TopBar";
import {
  type ConfluencePageDetail,
  getConfluencePage,
  saveConfluencePage,
  unsaveConfluencePage,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  navigate: Navigate;
  pageId: string;
}

export function ConfluenceDetailView({ navigate, pageId }: Props) {
  const [detail, setDetail] = React.useState<ConfluencePageDetail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exploreOpen, setExploreOpen] = React.useState(false);
  const [contextRefreshKey, setContextRefreshKey] = React.useState(0);

  React.useEffect(() => {
    void load();
  }, [pageId]);

  async function load() {
    setError(null);
    try {
      setDetail(await getConfluencePage(pageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleSave() {
    if (!detail) return;
    setBusy(true);
    try {
      if (detail.saved) {
        await unsaveConfluencePage(detail.id);
      } else {
        await saveConfluencePage(detail.id);
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
          <span className="flex items-center gap-2 truncate">
            <span className="truncate">{detail?.title ?? pageId}</span>
            {detail?.spaceKey ? <Badge>{detail.spaceKey}</Badge> : null}
          </span>
        }
        sub="Confluence page"
        right={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate({ view: "confluence-search" })}>
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
              <CardContent>
                <div className="max-h-[40rem] overflow-auto">
                  {detail.bodyMd ? (
                    <Markdown content={detail.bodyMd} />
                  ) : (
                    <p className="text-sm text-muted-foreground">(empty page)</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                {detail.saved ? (
                  <MetaContextEditor
                    key={contextRefreshKey}
                    scopeType="confluence"
                    scopeId={detail.id}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Save this page locally to attach meta-context notes.
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
          scopeType="confluence"
          scopeId={detail.id}
          open={exploreOpen}
          onClose={() => setExploreOpen(false)}
          onSaved={() => setContextRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  );
}
