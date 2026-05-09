import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardActivity } from "@/lib/api";

interface RecentActivityFeedProps {
  items: DashboardActivity[];
}

export function RecentActivityFeed({ items }: RecentActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">Recent activity</h2>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
                {timeAgo(item.ts)}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                  item.severity === "ok" && "border-success/40 bg-success/10 text-success",
                  item.severity === "warn" && "border-warn/40 bg-warn/10 text-warn",
                  item.severity === "bad" &&
                    "border-destructive/40 bg-destructive/10 text-destructive",
                  item.severity === "info" && "border-border bg-muted text-muted-foreground",
                )}
              >
                {item.title}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.sub}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const now = Date.now();
  // SQLite emits "YYYY-MM-DD HH:MM:SS" without a timezone — treat as UTC.
  const ts = iso.includes("T") ? new Date(iso).getTime() : new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ts)) return "—";
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}
