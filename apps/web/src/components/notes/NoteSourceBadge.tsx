import { MessageSquare, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoteSource } from "@agent-dock/shared";

interface NoteSourceBadgeProps {
  source: NoteSource;
}

export function NoteSourceBadge({ source }: NoteSourceBadgeProps) {
  if (source === "chat_response") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
          "border-primary/40 bg-primary/10 text-primary",
        )}
      >
        <MessageSquare className="h-3 w-3" />
        chat
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        "border-border bg-muted text-muted-foreground",
      )}
    >
      <Pencil className="h-3 w-3" />
      manual
    </span>
  );
}
