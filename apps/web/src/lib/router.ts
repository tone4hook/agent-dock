// Tiny in-process router. Phases 6+ navigate by setting a Route on App
// state — no URL changes (Neutralino app stays on a single window),
// no history stack. Adequate for v1; upgrade to react-router if/when
// browser-style nav (back button, deep links) is needed.

export type Route =
  | { view: "dashboard" }
  | { view: "chat"; threadId?: string }
  | { view: "tasks-board" }
  | { view: "sessions-list" }
  | { view: "notes" }
  | { view: "note-detail"; noteId: string }
  | { view: "settings" }
  | { view: "jira-search" }
  | { view: "jira-detail"; key: string }
  | { view: "confluence-search" }
  | { view: "confluence-detail"; id: string }
  | { view: "task-detail"; taskId: string; edit?: boolean }
  | { view: "session-detail"; sessionId: string }
  | { view: "games" };

export type Navigate = (route: Route) => void;
