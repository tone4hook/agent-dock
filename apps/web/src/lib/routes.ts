import type { ComponentType } from "react";
import {
  CheckSquare,
  FileText,
  Gamepad2,
  KanbanSquare,
  LayoutDashboard,
  MessageSquare,
  PlayCircle,
  StickyNote,
} from "lucide-react";
import type { Route } from "@/lib/router";

type IconType = ComponentType<{ className?: string }>;

export interface NavItem {
  key: NavKey;
  label: string;
  icon: IconType;
  to: Route;
  /** Marks views still being shipped in later phases. */
  comingPhase?: number;
}

/**
 * Per-NavKey live status indicators. Currently the only consumer is
 * `sessions`, which gets a red dot when at least one session is in
 * `awaiting_approval` with a failed review verdict — see Phase 31.
 */
export interface NavBadges {
  sessionsReviewFailed?: boolean;
}

export type NavKey =
  | "dashboard"
  | "chat"
  | "tasks"
  | "sessions"
  | "jira"
  | "confluence"
  | "notes"
  | "games";

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: { view: "dashboard" } },
  { key: "chat", label: "Chat", icon: MessageSquare, to: { view: "chat" } },
  { key: "tasks", label: "Tasks", icon: KanbanSquare, to: { view: "tasks-board" } },
  { key: "sessions", label: "Sessions", icon: PlayCircle, to: { view: "sessions-list" } },
  { key: "jira", label: "Jira", icon: CheckSquare, to: { view: "jira-search" } },
  { key: "confluence", label: "Confluence", icon: FileText, to: { view: "confluence-search" } },
  { key: "notes", label: "Notes", icon: StickyNote, to: { view: "notes" } },
  { key: "games", label: "Games", icon: Gamepad2, to: { view: "games" } },
];

/** Maps a Route view to the sidebar nav key that should be highlighted. */
export function navKeyForRoute(view: Route["view"]): NavKey | null {
  switch (view) {
    case "dashboard":
      return "dashboard";
    case "chat":
      return "chat";
    case "tasks-board":
      return "tasks";
    case "sessions-list":
    case "session-detail":
      return "sessions";
    case "jira-search":
    case "jira-detail":
      return "jira";
    case "confluence-search":
    case "confluence-detail":
      return "confluence";
    case "notes":
    case "note-detail":
      return "notes";
    case "games":
      return "games";
    case "task-detail":
      // Tasks live under the kanban; surface as Tasks active.
      return "tasks";
    default:
      return null;
  }
}
