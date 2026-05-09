import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TaskKanbanFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function TaskKanbanFilters({ query, onQueryChange }: TaskKanbanFiltersProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter tasks…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-8 pl-7 text-xs"
        />
      </div>
    </div>
  );
}
