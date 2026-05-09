import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CqlChipFilters } from "@/components/confluence/CqlChipFilters";
import { PageRow } from "@/components/confluence/PageRow";
import {
  searchConfluence,
  searchConfluenceChips,
  type ConfluenceSearchChip,
  type ConfluenceSearchHit,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  navigate: Navigate;
  savedIds: Set<string>;
}

const PAGE_SIZE = 25;

export function FindTab({ navigate, savedIds }: Props) {
  const [q, setQ] = React.useState("");
  const [filters, setFilters] = React.useState<ConfluenceSearchChip[]>([]);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [advancedCql, setAdvancedCql] = React.useState(
    'type = "page" AND lastmodified > now("-7d") ORDER BY lastmodified DESC',
  );
  const [hits, setHits] = React.useState<ConfluenceSearchHit[]>([]);
  const [total, setTotal] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  async function runSearch(startAt = 0) {
    setBusy(true);
    setError(null);
    try {
      const r = advancedOpen
        ? await searchConfluence(advancedCql, { startAt, maxResults: PAGE_SIZE })
        : await searchConfluenceChips(q.trim(), filters, { startAt, maxResults: PAGE_SIZE });
      setHits((cur) => (startAt === 0 ? r.results : [...cur, ...r.results]));
      setTotal(r.total);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="text-sm font-semibold">Find a page</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plain English — chips compose the CQL for you.
        </p>

        {advancedOpen ? (
          <Textarea
            className="mt-3 font-mono text-xs"
            value={advancedCql}
            rows={3}
            onChange={(e) => setAdvancedCql(e.target.value)}
          />
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
              placeholder="onboarding runbook for new web devs"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(0);
              }}
            />
            <Button size="sm" disabled={busy} onClick={() => void runSearch(0)}>
              Search
            </Button>
          </div>
        )}

        <div className="mt-3">
          <CqlChipFilters filters={filters} onChange={setFilters} />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {advancedOpen ? "← Back to chip search" : "Advanced (raw CQL) →"}
          </button>
          {advancedOpen && (
            <Button size="sm" disabled={busy} onClick={() => void runSearch(0)}>
              Run CQL
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
              {hits.length} of {total}
            </span>
          </div>
          {hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </div>
          ) : (
            hits.map((hit) => (
              <PageRow
                key={hit.id}
                page={hit}
                saved={savedIds.has(hit.id)}
                navigate={navigate}
              />
            ))
          )}
          {hits.length < total && (
            <div className="flex justify-center border-t border-border py-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void runSearch(hits.length)}
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
