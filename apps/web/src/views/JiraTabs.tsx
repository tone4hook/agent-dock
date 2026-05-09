import * as React from "react";
import { RefreshCw } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listSavedJira } from "@/lib/api";
import type { Navigate } from "@/lib/router";
import { MineTab } from "@/views/jira/MineTab";
import { SearchTab } from "@/views/jira/SearchTab";
import { SprintTab } from "@/views/jira/SprintTab";
import { jiraCache } from "@/views/jira/cache";

interface Props {
  navigate: Navigate;
}

type TabId = "sprint" | "mine" | "search";

export function JiraTabs({ navigate }: Props) {
  const [tab, setTab] = React.useState<TabId>("sprint");
  const [savedKeys, setSavedKeys] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    void listSavedJira()
      .then((keys) => setSavedKeys(new Set(keys)))
      .catch(() => {});
  }, [tab]);

  function handleRefresh() {
    if (tab === "sprint") jiraCache.refreshSprint();
    else if (tab === "mine") jiraCache.refreshMine();
    else if (tab === "search") jiraCache.refreshSearch();
  }

  return (
    <>
      <TopBar title="Jira" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-5 py-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <div className="flex items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="sprint">Current sprint</TabsTrigger>
                <TabsTrigger value="mine">My tickets</TabsTrigger>
                <TabsTrigger value="search">Search</TabsTrigger>
              </TabsList>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                title={`Refresh ${tab}`}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>

            <TabsContent value="sprint" className="mt-4">
              <SprintTab savedKeys={savedKeys} navigate={navigate} />
            </TabsContent>
            <TabsContent value="mine" className="mt-4">
              <MineTab savedKeys={savedKeys} navigate={navigate} />
            </TabsContent>
            <TabsContent value="search" className="mt-4">
              <SearchTab savedKeys={savedKeys} navigate={navigate} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
