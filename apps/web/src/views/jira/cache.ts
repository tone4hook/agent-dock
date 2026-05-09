import * as React from "react";
import type {
  JiraSearchChip,
  JiraSearchHit,
  JiraSprintIssue,
  JiraSprintSummary,
} from "@/lib/api";

export interface SprintSlice {
  sprint: JiraSprintSummary | null;
  issues: JiraSprintIssue[];
}
export interface MineSlice {
  issues: JiraSearchHit[];
  nextPageToken: string | null;
  isLast: boolean;
}
export interface SearchSlice {
  q: string;
  filters: JiraSearchChip[];
  advancedOpen: boolean;
  advancedJql: string;
  issues: JiraSearchHit[];
  nextPageToken: string | null;
  isLast: boolean;
  hasSearched: boolean;
}

let sprint: SprintSlice | null = null;
let mine: MineSlice | null = null;
let search: SearchSlice | null = null;
let searchRefreshSignal = 0;

const subs = new Set<() => void>();

interface Snapshot {
  sprint: SprintSlice | null;
  mine: MineSlice | null;
  search: SearchSlice | null;
  searchRefreshSignal: number;
}

let snap: Snapshot = { sprint, mine, search, searchRefreshSignal };
function commit() {
  snap = { sprint, mine, search, searchRefreshSignal };
  subs.forEach((f) => f());
}

export const jiraCache = {
  setSprint: (v: SprintSlice | null) => {
    sprint = v;
    commit();
  },
  refreshSprint: () => {
    sprint = null;
    commit();
  },

  setMine: (v: MineSlice | null) => {
    mine = v;
    commit();
  },
  refreshMine: () => {
    mine = null;
    commit();
  },

  setSearch: (v: SearchSlice | null) => {
    search = v;
    commit();
  },
  refreshSearch: () => {
    searchRefreshSignal += 1;
    commit();
  },

  subscribe: (f: () => void) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useJiraCache(): Snapshot {
  return React.useSyncExternalStore(jiraCache.subscribe, () => snap);
}
