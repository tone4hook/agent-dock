import * as React from "react";
import { Inbox } from "lucide-react";
import { PageRow } from "@/components/confluence/PageRow";
import { listSavedConfluence, type SavedConfluencePage } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  navigate: Navigate;
  /** Refresh trigger — bump to force a re-fetch (e.g. after a save toggle). */
  refreshKey?: number;
  onLoaded?: (pages: SavedConfluencePage[]) => void;
}

export function SavedTab({ navigate, refreshKey = 0, onLoaded }: Props) {
  const [pages, setPages] = React.useState<SavedConfluencePage[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    void listSavedConfluence()
      .then((rows) => {
        if (cancelled) return;
        setPages(rows);
        onLoaded?.(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, onLoaded]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Failed to load saved pages: {error}
      </div>
    );
  }

  if (pages === null) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
        Loading saved pages…
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card px-3 py-10 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">No saved pages yet</div>
        <p className="max-w-md text-xs text-muted-foreground">
          Search for a page in the Find tab and click the save button on its detail page —
          it will show up here next time.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
        Saved
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {pages.length} {pages.length === 1 ? "page" : "pages"}
        </span>
      </div>
      {pages.map((p) => (
        <PageRow
          key={p.id}
          page={{
            id: p.id,
            title: p.title,
            // Saved metadata doesn't carry spaceKey today (the cached
            // payload focuses on title/body). The PageRow renders "—"
            // for null spaceKey, which is fine for this surface.
            spaceKey: null,
            updatedAt: p.updatedAt,
          }}
          saved
          navigate={navigate}
        />
      ))}
    </div>
  );
}
