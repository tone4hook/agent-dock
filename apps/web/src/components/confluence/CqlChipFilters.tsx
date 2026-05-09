import { ChevronDown, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ConfluenceChipKind, ConfluenceSearchChip } from "@/lib/api";

interface ChipMeta {
  label: string;
  /** Predefined value picks. Spaces/labels are free-text — use `freeText: true`. */
  options: { value: string; label: string }[];
  freeText?: boolean;
  placeholder?: string;
}

const CHIP_META: Record<ConfluenceChipKind, ChipMeta> = {
  space: {
    label: "Space",
    options: [],
    freeText: true,
    placeholder: "Space key (e.g. WEB)",
  },
  author: {
    label: "Author",
    options: [
      { value: "me", label: "Me" },
    ],
  },
  updated: {
    label: "Updated",
    options: [
      { value: "today", label: "Today" },
      { value: "this_week", label: "This week" },
      { value: "this_month", label: "This month" },
      { value: "this_year", label: "This year" },
    ],
  },
  label: {
    label: "Has label",
    options: [],
    freeText: true,
    placeholder: "Label (e.g. runbook)",
  },
};

const ADD_KINDS: ConfluenceChipKind[] = ["space", "author", "updated", "label"];

interface CqlChipFiltersProps {
  filters: ConfluenceSearchChip[];
  onChange: (next: ConfluenceSearchChip[]) => void;
}

export function CqlChipFilters({ filters, onChange }: CqlChipFiltersProps) {
  const usedKinds = new Set(filters.map((f) => f.kind));

  function set(kind: ConfluenceChipKind, value: string) {
    const without = filters.filter((f) => f.kind !== kind);
    onChange([...without, { kind, value }]);
  }
  function remove(kind: ConfluenceChipKind) {
    onChange(filters.filter((f) => f.kind !== kind));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Filters</span>
      {filters.map((f) => {
        const meta = CHIP_META[f.kind];
        const opt = meta.options.find((o) => o.value === f.value);
        return (
          <Chip
            key={f.kind}
            kind={f.kind}
            value={f.value}
            label={`${meta.label}: ${(opt?.label ?? f.value) || "(none)"}`}
            meta={meta}
            onClear={() => remove(f.kind)}
            onPick={(value) => set(f.kind, value)}
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
              <DropdownMenuItem
                key={kind}
                onSelect={() => {
                  const meta = CHIP_META[kind];
                  set(kind, meta.options[0]?.value ?? "");
                }}
              >
                {CHIP_META[kind].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Chip({
  kind,
  value,
  label,
  meta,
  onPick,
  onClear,
}: {
  kind: ConfluenceChipKind;
  value: string;
  label: string;
  meta: ChipMeta;
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        "border-primary/40 bg-primary/10 text-primary",
      )}
    >
      {meta.freeText ? (
        <span className="inline-flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide opacity-70">{meta.label}:</span>
          <Input
            value={value}
            placeholder={meta.placeholder}
            onChange={(e) => onPick(e.target.value)}
            className="h-5 w-32 border-transparent bg-transparent px-1 py-0 text-xs focus-visible:ring-0"
          />
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1">
            {label}
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {meta.options.map((o) => (
              <DropdownMenuItem key={o.value} onSelect={() => onPick(o.value)}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${kind} filter`}
        className="rounded-sm hover:bg-primary/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
