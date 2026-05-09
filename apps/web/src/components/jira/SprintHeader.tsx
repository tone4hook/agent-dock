import type { JiraSprintIssue, JiraSprintSummary } from "@/lib/api";

interface SprintHeaderProps {
  sprint: JiraSprintSummary;
  issues: JiraSprintIssue[];
}

export function SprintHeader({ sprint, issues }: SprintHeaderProps) {
  const done = issues.filter((i) => i.statusCategory === "done").length;
  const total = issues.length;
  const daysLeft = sprint.endDate ? daysBetween(new Date(), new Date(sprint.endDate)) : null;

  const dates =
    sprint.startDate && sprint.endDate
      ? `${formatDate(sprint.startDate)} → ${formatDate(sprint.endDate)}`
      : "no dates";

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xl font-semibold leading-tight">{sprint.name}</div>
          <div className="text-xs text-muted-foreground">{dates}</div>
        </div>
        <div className="flex items-baseline gap-6">
          <Stat label="Days left" value={daysLeft != null ? `${Math.max(0, daysLeft)}` : "—"} />
          <Stat label="Done" value={`${done} / ${total}`} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
