import * as React from "react";
import { getDashboardSummary, type DashboardSummary } from "@/lib/api";

const POLL_MS = 5000;

interface UseDashboardResult {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetches the dashboard summary on mount and re-polls every 5s while at
 * least one running session is non-terminal. Idle workspaces refetch
 * only on explicit `reload()` (e.g. when the user clicks Refresh).
 */
export function useDashboard(): UseDashboardResult {
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDashboardSummary()
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const hasLive = (summary?.runningSessions.length ?? 0) > 0;

  React.useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [hasLive]);

  const reload = React.useCallback(() => setTick((n) => n + 1), []);

  return { summary, loading, error, reload };
}
