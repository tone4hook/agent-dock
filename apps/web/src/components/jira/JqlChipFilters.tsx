import { ChevronDown, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { JiraChipKind, JiraSearchChip } from "@/lib/api";

const CHIP_OPTIONS: Record<
  JiraChipKind,
  { label: string; options: { value: string; label: string }[] }
> = {
  status: {
    label: "Status",
    options: [
      { value: "open", label: "To Do" },
      { value: "in_progress", label: "In Progress" },
      { value: "done", label: "Done" },
    ],
  },
  assignee: {
    label: "Assignee",
    options: [
      { value: "me", label: "Me" },
      { value: "unassigned", label: "Unassigned" },
    ],
  },
  updated: {
    label: "Updated",
    options: [
      { value: "today", label: "Today" },
      { value: "this_week", label: "This week" },
      { value: "this_month", label: "This month" },
      { value: "recent", label: "Last 7 days" },
    ],
  },
  type: {
    label: "Type",
    options: [
      { value: "Bug", label: "Bug" },
      { value: "Task", label: "Task" },
      { value: "Story", label: "Story" },
      { value: "Epic", label: "Epic" },
    ],
  },
  project: {
    label: "Project",
    options: [],
  },
};

interface JqlChipFiltersProps {
  filters: JiraSearchChip[];
  onChange: (next: JiraSearchChip[]) => void;
}

const ADD_KINDS: JiraChipKind[] = ["status", "assignee", "updated", "type"];

export function JqlChipFilters({ filters, onChange }: JqlChipFiltersProps) {
  const usedKinds = new Set(filters.map((f) => f.kind));

  function set(kind: JiraChipKind, value: string) {
    const without = filters.filter((f) => f.kind !== kind);
    onChange([...without, { kind, value }]);
  }

  function remove(kind: JiraChipKind) {
    onChange(filters.filter((f) => f.kind !== kind));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Filters</span>
      {filters.map((f) => {
        const meta = CHIP_OPTIONS[f.kind];
        const opt = meta.options.find((o) => o.value === f.value);
        return (
          <Chip
            key={f.kind}
            label={`${meta.label}: ${opt?.label ?? f.value}`}
            active
            onClear={() => remove(f.kind)}
            onPick={(value) => set(f.kind, value)}
            options={meta.options}
          />
        );
      })}
      {ADD_KINDS.filter((k) => !usedKinds.has(k)).length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3" />
            Add filter
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Add filter</DropdownMenuLabel>
            {ADD_KINDS.filter((k) => !usedKinds.has(k)).map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => set(kind, CHIP_OPTIONS[kind].options[0].value)}>
                {CHIP_OPTIONS[kind].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  options,
  onPick,
  onClear,
}: {
  label: string;
  active?: boolean;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1">
          {label}
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => onPick(o.value)}>
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="rounded-sm hover:bg-primary/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
