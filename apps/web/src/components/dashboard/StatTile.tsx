import { cn } from "@/lib/utils";

interface StatTileProps {
  value: string | number;
  label: string;
  sub?: string;
  tone?: "default" | "warn" | "ok" | "bad";
}

export function StatTile({ value, label, sub, tone = "default" }: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3",
        tone === "warn" && "border-warn/40 bg-warn/10",
        tone === "ok" && "border-success/40 bg-success/10",
        tone === "bad" && "border-destructive/40 bg-destructive/10",
        tone === "default" && "border-border bg-card",
      )}
    >
      <div className="text-3xl font-semibold leading-none">{value}</div>
      <div className="mt-2 text-sm font-medium">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
