import React from "react";
import { Shell } from "@/components/Shell";
import { Onboarding } from "@/views/Onboarding";
import { Dashboard } from "@/views/Dashboard";
import { Settings } from "@/views/Settings";
import { JiraTabs } from "@/views/JiraTabs";
import { JiraDetailView } from "@/views/JiraDetail";
import { ConfluenceSearch } from "@/views/ConfluenceSearch";
import { ConfluenceDetailView } from "@/views/ConfluenceDetail";
import { TaskDetailView } from "@/views/TaskDetail";
import { TasksKanban } from "@/views/TasksKanban";
import { SessionsList } from "@/views/SessionsList";
import { SessionDetailView } from "@/views/SessionDetail";
import { NotesPage } from "@/views/NotesPage";
import { ChatPage } from "@/views/ChatPage";
import { NoteDetail } from "@/views/NoteDetail";
import { GamesPage } from "@/views/GamesPage";
import {
  getDashboardSummary,
  getRuntimeSettings,
  getWorkspaceState,
  type WorkspaceState,
} from "@/lib/api";
import { WelcomeModal } from "@/components/welcome/WelcomeModal";
import { useActiveProject } from "@/lib/useActiveProject";
import type { Navigate, Route } from "@/lib/router";

type Status = "loading" | "needs_workspace" | "ready" | "error";

export function App() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [state, setState] = React.useState<WorkspaceState | null>(null);
  const [route, setRoute] = React.useState<Route>({ view: "dashboard" });
  const [, setHistory] = React.useState<Route[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = React.useState(false);
  const [reviewFailedCount, setReviewFailedCount] = React.useState(0);
  const { activeId, setActiveId } = useActiveProject(state?.projects ?? []);

  React.useEffect(() => {
    void load();
  }, []);

  // Poll the dashboard summary every 15s to refresh sidebar badges.
  // Cheap query, single user — keeps the indicator current without
  // building a server-push channel for what is effectively a status dot.
  React.useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    async function tick() {
      try {
        const s = await getDashboardSummary();
        if (!cancelled) setReviewFailedCount(s.reviewFailed);
      } catch {
        /* informational; the dashboard view itself surfaces hard errors */
      }
    }
    void tick();
    const t = setInterval(() => void tick(), 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [status]);

  async function load() {
    setStatus("loading");
    try {
      const next = await getWorkspaceState();
      setState(next);
      setStatus(next.workspaceDir ? "ready" : "needs_workspace");
      // Auto-open the welcome modal only post-onboarding so it doesn't
      // stack on top of the workspace picker. Errors are non-fatal.
      if (next.workspaceDir) {
        try {
          const settings = await getRuntimeSettings();
          if (!settings.welcomeDismissed) setWelcomeOpen(true);
        } catch {
          /* ignore — settings fetch is informational, not load-bearing */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const navigate: Navigate = React.useCallback((next) => {
    setRoute((cur) => {
      // Only push to history when actually moving to a different view shape.
      if (sameRoute(cur, next)) return cur;
      setHistory((h) => [...h, cur].slice(-20));
      return next;
    });
  }, []);

  const goBack = React.useCallback(
    (fallback: Route) => {
      setHistory((h) => {
        if (h.length === 0) {
          setRoute(fallback);
          return h;
        }
        const prev = h[h.length - 1];
        setRoute(prev);
        return h.slice(0, -1);
      });
    },
    [],
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="max-w-md rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Could not reach the agent-dock API.</p>
          <p className="mt-1 font-mono">{error}</p>
          <p className="mt-3">Is the backend running on port 8792?</p>
        </div>
      </div>
    );
  }

  if (status === "needs_workspace" || !state?.workspaceDir) {
    return (
      <Onboarding
        onComplete={(next) => {
          setState(next);
          setStatus("ready");
          setRoute({ view: "dashboard" });
        }}
      />
    );
  }

  function renderView() {
    if (!state) return null;
    switch (route.view) {
      case "settings":
        return (
          <Settings
            onBack={() => navigate({ view: "dashboard" })}
            onShowWelcome={() => setWelcomeOpen(true)}
          />
        );
      case "jira-search":
        return <JiraTabs navigate={navigate} />;
      case "jira-detail":
        return <JiraDetailView navigate={navigate} issueKey={route.key} />;
      case "confluence-search":
        return <ConfluenceSearch navigate={navigate} />;
      case "confluence-detail":
        return <ConfluenceDetailView navigate={navigate} pageId={route.id} />;
      case "task-detail":
        return (
          <TaskDetailView
            navigate={navigate}
            taskId={route.taskId}
            startInEditMode={route.edit ?? false}
          />
        );
      case "session-detail":
        return (
          <SessionDetailView
            navigate={navigate}
            sessionId={route.sessionId}
            onBack={(fallback) => goBack(fallback)}
          />
        );
      case "chat":
        return (
          <ChatPage
            threadId={route.threadId}
            projects={state.projects}
            workspaceDir={state.workspaceDir}
            activeProjectId={activeId}
            navigate={navigate}
          />
        );
      case "tasks-board":
        return (
          <TasksKanban
            projects={state.projects}
            activeProjectId={activeId}
            onSelectProject={setActiveId}
            navigate={navigate}
          />
        );
      case "sessions-list":
        return <SessionsList navigate={navigate} />;
      case "notes":
        return <NotesPage projects={state.projects} navigate={navigate} />;
      case "note-detail":
        return (
          <NoteDetail
            noteId={route.noteId}
            navigate={navigate}
            onBack={(fallback) => goBack(fallback)}
          />
        );
      case "games":
        return <GamesPage />;
      case "dashboard":
      default:
        return (
          <Dashboard
            workspaceDir={state.workspaceDir}
            navigate={navigate}
            activeProjectId={activeId}
            onSelectProject={setActiveId}
          />
        );
    }
  }

  return (
    <Shell
      route={route}
      navigate={navigate}
      workspaceDir={state.workspaceDir}
      projects={state.projects}
      activeProjectId={activeId}
      onSelectProject={setActiveId}
      navBadges={{ sessionsReviewFailed: reviewFailedCount > 0 }}
    >
      {renderView()}
      <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
    </Shell>
  );
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false;
  // For routes with id-shaped fields, compare those too so the back-stack
  // doesn't dedupe across distinct entities.
  if (a.view === "task-detail" && b.view === "task-detail") return a.taskId === b.taskId;
  if (a.view === "session-detail" && b.view === "session-detail") return a.sessionId === b.sessionId;
  if (a.view === "jira-detail" && b.view === "jira-detail") return a.key === b.key;
  if (a.view === "confluence-detail" && b.view === "confluence-detail") return a.id === b.id;
  if (a.view === "note-detail" && b.view === "note-detail") return a.noteId === b.noteId;
  if (a.view === "chat" && b.view === "chat") return a.threadId === b.threadId;
  return true;
}
