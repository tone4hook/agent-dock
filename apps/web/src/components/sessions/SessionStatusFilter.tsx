import type { SessionStatus } from "@agent-dock/shared";
import { cn } from "@/lib/utils";

export type SessionStatusFilterValue = SessionStatus | "all";

const FILTERS: { value: SessionStatusFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "awaiting_approval", label: "Awaiting" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "draft", label: "Draft" },
];

interface SessionStatusFilterProps {
  value: SessionStatusFilterValue;
  onChange: (value: SessionStatusFilterValue) => void;
}

export function SessionStatusFilter({ value, onChange }: SessionStatusFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
