import { Plus } from "lucide-react";
import { TaskCard } from "@/components/tasks/TaskCard";
import type { TaskWithCounts } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface KanbanColumnProps {
  name: string;
  tasks: TaskWithCounts[];
  navigate: Navigate;
  onAddTask?: () => void;
}

export function KanbanColumn({ name, tasks, navigate, onAddTask }: KanbanColumnProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-md border border-border bg-muted/30 p-2">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-sm font-semibold">{name}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
            No tasks
          </div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} navigate={navigate} />)
        )}
      </div>
      {onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add task
        </button>
      )}
    </div>
  );
}
