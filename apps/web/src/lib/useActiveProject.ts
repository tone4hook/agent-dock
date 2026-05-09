import * as React from "react";
import type { Project } from "@agent-dock/shared";

const STORAGE_KEY = "ui-active-project-id";

/**
 * Tracks the user's currently-selected project across the app.
 * Persists to localStorage so a reload lands on the same project.
 * If the persisted id is no longer in `projects`, falls back to the first project.
 */
export function useActiveProject(projects: Project[]) {
  const [activeId, setActiveIdState] = React.useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  // Reconcile if the persisted id doesn't exist (yet, or anymore).
  React.useEffect(() => {
    if (projects.length === 0) return;
    const stillExists = activeId && projects.some((p) => p.id === activeId);
    if (!stillExists) {
      setActiveIdState(projects[0].id);
    }
  }, [projects, activeId]);

  React.useEffect(() => {
    if (activeId) window.localStorage.setItem(STORAGE_KEY, activeId);
  }, [activeId]);

  const setActiveId = React.useCallback((id: string) => setActiveIdState(id), []);
  const active = projects.find((p) => p.id === activeId) ?? null;

  return { activeId, active, setActiveId };
}
