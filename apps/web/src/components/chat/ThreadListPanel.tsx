import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatThread } from "@/lib/api";
import { modelLabel } from "@/components/chat/ModelPicker";
import { cn } from "@/lib/utils";

interface ThreadListPanelProps {
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  width: number;
  onStartResize: (e: React.MouseEvent) => void;
}

export function ThreadListPanel({
  threads,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  width,
  onStartResize,
}: ThreadListPanelProps) {
  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-muted/10"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chats
        </span>
        <Button size="sm" variant="ghost" onClick={onCreate} title="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {threads.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No chats yet. Start one with "+".
            </div>
          ) : (
            threads.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                active={t.id === activeId}
                onClick={() => onSelect(t.id)}
                onDelete={() => onDelete(t.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat list"
        onMouseDown={onStartResize}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
      />
    </aside>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
  onDelete,
}: {
  thread: ChatThread;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      className={cn(
        "group mb-1 flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
          title="Delete chat"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{modelLabel(thread.model)}</span>
        <span className="shrink-0">{timeAgo(thread.updatedAt)}</span>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  if (Number.isNaN(diff)) return "";
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
