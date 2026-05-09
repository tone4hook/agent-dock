import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IssueRow } from "@/components/jira/IssueRow";
import { JqlChipFilters } from "@/components/jira/JqlChipFilters";
import {
  searchJira,
  searchJiraChips,
  type JiraSearchChip,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";
import { jiraCache, useJiraCache, type SearchSlice } from "@/views/jira/cache";

interface Props {
  savedKeys: Set<string>;
  navigate: Navigate;
}

const DEFAULT_ADVANCED_JQL =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

function emptySlice(): SearchSlice {
  return {
    q: "",
    filters: [],
    advancedOpen: false,
    advancedJql: DEFAULT_ADVANCED_JQL,
    issues: [],
    nextPageToken: null,
    isLast: true,
    hasSearched: false,
  };
}

export function SearchTab({ savedKeys, navigate }: Props) {
  const snap = useJiraCache();
  const cached = snap.search ?? emptySlice();
  const refreshSignal = snap.searchRefreshSignal;

  const [q, setQ] = React.useState(cached.q);
  const [filters, setFilters] = React.useState<JiraSearchChip[]>(cached.filters);
  const [advancedOpen, setAdvancedOpen] = React.useState(cached.advancedOpen);
  const [advancedJql, setAdvancedJql] = React.useState(cached.advancedJql);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Persist form fields back to cache so other navigations can restore them.
  React.useEffect(() => {
    const cur = snap.search ?? emptySlice();
    jiraCache.setSearch({ ...cur, q, filters, advancedOpen, advancedJql });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filters, advancedOpen, advancedJql]);

  const runSearch = React.useCallback(
    async (token?: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = advancedOpen
          ? await searchJira(advancedJql, token ? { nextPageToken: token } : {})
          : await searchJiraChips(q.trim(), filters, token ? { nextPageToken: token } : {});
        const prev = snap.search ?? emptySlice();
        jiraCache.setSearch({
          ...prev,
          q,
          filters,
          advancedOpen,
          advancedJql,
          issues: token ? [...prev.issues, ...r.issues] : r.issues,
          nextPageToken: r.nextPageToken,
          isLast: r.isLast,
          hasSearched: true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    // snap is intentionally read live via a ref-like access; capture the
    // form state instead.
    [q, filters, advancedOpen, advancedJql, snap.search],
  );

  // React to header Refresh button: re-run with current form when triggered.
  const lastSignalRef = React.useRef(refreshSignal);
  React.useEffect(() => {
    if (refreshSignal === lastSignalRef.current) return;
    lastSignalRef.current = refreshSignal;
    if (cached.hasSearched) void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const issues = cached.issues;
  const nextPageToken = cached.nextPageToken;
  const isLast = cached.isLast;
  const hasSearched = cached.hasSearched;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="text-sm font-semibold">Find an issue</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plain English — chips compose the JQL for you.
        </p>

        {advancedOpen ? (
          <Textarea
            className="mt-3 font-mono text-xs"
            value={advancedJql}
            rows={3}
            onChange={(e) => setAdvancedJql(e.target.value)}
          />
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
              placeholder="my open bugs in WebApp updated this week"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
            />
            <Button size="sm" disabled={busy} onClick={() => void runSearch()}>
              Search
            </Button>
          </div>
        )}

        <div className="mt-3">
          <JqlChipFilters filters={filters} onChange={setFilters} />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {advancedOpen ? "← Back to chip search" : "Advanced (raw JQL) →"}
          </button>
          {advancedOpen && (
            <Button size="sm" disabled={busy} onClick={() => void runSearch()}>
              Run JQL
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {hasSearched && (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
            Results
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {issues.length}
              {isLast ? "" : "+"}
            </span>
          </div>
          {issues.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </div>
          ) : (
            issues.map((i) => (
              <IssueRow key={i.key} issue={i} saved={savedKeys.has(i.key)} navigate={navigate} />
            ))
          )}
          {!isLast && nextPageToken && (
            <div className="flex justify-center border-t border-border py-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void runSearch(nextPageToken)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
