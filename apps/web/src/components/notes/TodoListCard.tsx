import type { TodoItem, TodoList } from "@agent-dock/shared";

interface TodoListCardProps {
  list: TodoList & { items: TodoItem[] };
  onClick: () => void;
}

export function TodoListCard({ list, onClick }: TodoListCardProps) {
  const done = list.items.filter((i) => i.done).length;
  const total = list.items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const preview = list.items.slice(0, 5);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col rounded-md border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{list.name}</span>
        <span className="text-xs text-muted-foreground">
          {done} / {total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 flex-1 space-y-1 text-xs">
        {preview.length === 0 ? (
          <li className="text-muted-foreground">No items yet.</li>
        ) : (
          preview.map((it) => (
            <li
              key={it.id}
              className={`flex items-center gap-2 ${it.done ? "text-muted-foreground line-through" : ""}`}
            >
              <span
                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${it.done ? "border-success/40 bg-success/20" : "border-border bg-background"}`}
              >
                {it.done ? "✓" : ""}
              </span>
              <span className="truncate">{it.body}</span>
            </li>
          ))
        )}
        {list.items.length > preview.length && (
          <li className="pl-5 text-muted-foreground">
            + {list.items.length - preview.length} more…
          </li>
        )}
      </ul>
    </button>
  );
}
