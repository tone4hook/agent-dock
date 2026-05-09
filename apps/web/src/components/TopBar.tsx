import * as React from "react";
import { ModeToggle } from "@/components/ModeToggle";

interface TopBarProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}

export function TopBar({ title, sub, right }: TopBarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight">{title}</div>
        {sub && (
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <ModeToggle />
      </div>
    </header>
  );
}
