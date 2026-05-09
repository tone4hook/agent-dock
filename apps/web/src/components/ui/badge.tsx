import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md border border-border bg-secondary px-2 text-xs font-medium text-secondary-foreground", className)}>
      {children}
    </span>
  );
}
