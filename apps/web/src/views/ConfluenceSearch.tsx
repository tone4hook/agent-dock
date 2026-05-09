import * as React from "react";
import { TopBar } from "@/components/TopBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listSavedConfluence, type SavedConfluencePage } from "@/lib/api";
import type { Navigate } from "@/lib/router";
import { FindTab } from "@/views/confluence/FindTab";
import { SavedTab } from "@/views/confluence/SavedTab";

interface Props {
  navigate: Navigate;
}

type TabId = "saved" | "find";

export function ConfluenceSearch({ navigate }: Props) {
  // Initial tab decision needs to know whether the cache is empty —
  // start with `null` (loading) so the tabs render in their default
  // state until the first `listSavedConfluence` call resolves. After
  // that we never rebuild from server state; the user's tab choice
  // wins.
  const [tab, setTab] = React.useState<TabId | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  // Bumped to force SavedTab to re-fetch (e.g. after a save toggle on
  // a detail page). Today only the initial mount uses it; future hooks
  // can wire it to a save event for live refresh.
  const [refreshKey] = React.useState(0);

  const handleLoaded = React.useCallback((pages: SavedConfluencePage[]) => {
    setSavedIds(new Set(pages.map((p) => p.id)));
    // Default tab decision: Saved if there's anything cached, else Find.
    setTab((prev) => prev ?? (pages.length > 0 ? "saved" : "find"));
  }, []);

  React.useEffect(() => {
    // Pre-fetch ids for the saved-badge on Find search results even if
    // the user's first interaction stays in Find — we still want the
    // gold star on rows that are already saved.
    void listSavedConfluence()
      .then(handleLoaded)
      .catch(() => {
        // Fall through: tab default to Find on cache load failure so
        // the UI is still usable.
        setTab((prev) => prev ?? "find");
      });
  }, [handleLoaded]);

  const activeTab: TabId = tab ?? "saved";

  return (
    <>
      <TopBar title="Confluence" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-5 py-5">
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList>
              <TabsTrigger value="saved">Saved</TabsTrigger>
              <TabsTrigger value="find">Find</TabsTrigger>
            </TabsList>

            <TabsContent value="saved" className="mt-4">
              <SavedTab
                navigate={navigate}
                refreshKey={refreshKey}
                onLoaded={handleLoaded}
              />
            </TabsContent>

            <TabsContent value="find" className="mt-4">
              <FindTab navigate={navigate} savedIds={savedIds} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
