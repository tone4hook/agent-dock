import * as React from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, navKeyForRoute, type NavBadges, type NavKey } from "@/lib/routes";
import type { Navigate, Route } from "@/lib/router";

interface SidebarProps {
  route: Route;
  navigate: Navigate;
  collapsed: boolean;
  switcherSlot?: React.ReactNode;
  badges?: NavBadges;
}

export function Sidebar({ route, navigate, collapsed, switcherSlot, badges }: SidebarProps) {
  const activeKey = navKeyForRoute(route.view);
  const onSettings = route.view === "settings";
  const hasDot = (key: NavKey) => key === "sessions" && !!badges?.sessionsReviewFailed;

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-3", collapsed && "justify-center px-0")}>
        <BrandIcon className="h-7 w-7 text-primary" />
        {!collapsed && <span className="font-semibold tracking-tight">Agent*Dock</span>}
      </div>

      {switcherSlot && <div className="px-2 pb-2">{switcherSlot}</div>}

      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.key}
            label={item.label}
            icon={<item.icon className="h-4 w-4" />}
            active={item.key === activeKey}
            collapsed={collapsed}
            onClick={() => navigate(item.to)}
            badge={item.comingPhase ? `P${item.comingPhase}` : null}
            dot={hasDot(item.key)}
          />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-sidebar-border px-2 py-2">
        <NavButton
          label="Settings"
          icon={<SettingsIcon className="h-4 w-4" />}
          active={onSettings}
          collapsed={collapsed}
          onClick={() => navigate({ view: "settings" })}
        />
      </div>
    </aside>
  );
}

function NavButton({
  label,
  icon,
  active,
  collapsed,
  onClick,
  badge,
  dot,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  badge?: string | null;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? (dot ? `${label} — review failed` : label) : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="relative text-current">
        {icon}
        {dot && collapsed && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive ring-1 ring-sidebar"
          />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          {dot && (
            <span
              aria-label="review failed"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
            />
          )}
          {badge && (
            <span className="rounded-sm bg-muted px-1 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
