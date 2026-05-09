import { Search } from "lucide-react";
import type { Project } from "@agent-dock/shared";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type NoteSourceFilter = "all" | "manual" | "chat_response";
export type NoteSortOrder = "updated" | "created";

interface NoteFiltersProps {
  source: NoteSourceFilter;
  onSourceChange: (next: NoteSourceFilter) => void;
  projectId: string | "all";
  onProjectChange: (next: string | "all") => void;
  projects: Project[];
  query: string;
  onQueryChange: (next: string) => void;
  sort: NoteSortOrder;
  onSortChange: (next: NoteSortOrder) => void;
}

export function NoteFilters({
  source,
  onSourceChange,
  projectId,
  onProjectChange,
  projects,
  query,
  onQueryChange,
  sort,
  onSortChange,
}: NoteFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search notes — title, body, tags…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-8 pl-7 text-xs"
        />
      </div>
      <Select value={source} onValueChange={(v) => onSourceChange(v as NoteSourceFilter)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
          <SelectItem value="chat_response">From chat</SelectItem>
        </SelectContent>
      </Select>
      <Select value={projectId} onValueChange={(v) => onProjectChange(v)}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sort} onValueChange={(v) => onSortChange(v as NoteSortOrder)}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated">Sort: updated</SelectItem>
          <SelectItem value="created">Sort: created</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
