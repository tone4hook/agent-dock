import { Plus } from "lucide-react";
import { TODO_LIST_CAP, type TodoItem, type TodoList } from "@agent-dock/shared";
import { TodoListCard } from "@/components/notes/TodoListCard";

type TodoListWithItems = TodoList & { items: TodoItem[] };

interface TodoListsRowProps {
  lists: TodoListWithItems[];
  onEdit: (list: TodoListWithItems) => void;
  onAdd: () => void;
}

export function TodoListsRow({ lists, onEdit, onAdd }: TodoListsRowProps) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold">ToDo lists</h2>
        <span className="text-xs text-muted-foreground">
          {lists.length} / {TODO_LIST_CAP} · cap
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {lists.map((l) => (
          <TodoListCard key={l.id} list={l} onClick={() => onEdit(l)} />
        ))}
        {lists.length < TODO_LIST_CAP && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-[10rem] flex-1 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            New list
          </button>
        )}
      </div>
    </section>
  );
}
