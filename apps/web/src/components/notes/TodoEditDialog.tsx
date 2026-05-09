import * as React from "react";
import { TODO_LIST_CAP, type TodoItem, type TodoList } from "@agent-dock/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

export interface TodoListWithItems extends TodoList {
  items: TodoItem[];
}

interface TodoEditDialogProps {
  open: boolean;
  initial?: TodoListWithItems | null;
  totalCount: number;
  onClose: () => void;
  onCreateList: (name: string) => Promise<TodoListWithItems>;
  onRenameList: (id: string, name: string) => Promise<void>;
  onDeleteList: (id: string) => Promise<void>;
  onCreateItem: (listId: string, body: string) => Promise<TodoItem>;
  onUpdateItem: (
    listId: string,
    itemId: string,
    patch: { done?: boolean; body?: string },
  ) => Promise<void>;
  onDeleteItem: (listId: string, itemId: string) => Promise<void>;
}

export function TodoEditDialog(props: TodoEditDialogProps) {
  const {
    open,
    initial,
    totalCount,
    onClose,
    onCreateList,
    onRenameList,
    onDeleteList,
    onCreateItem,
    onUpdateItem,
    onDeleteItem,
  } = props;
  const isNew = !initial;

  // Local working copy of the list. While creating, we hold the unsaved
  // name; once saved, we mirror server state.
  const [name, setName] = React.useState("");
  const [list, setList] = React.useState<TodoListWithItems | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setList(initial ?? null);
      setDraft("");
      setError(null);
    }
  }, [open, initial]);

  const capReached = isNew && totalCount >= TODO_LIST_CAP;

  async function ensureList(): Promise<TodoListWithItems | null> {
    if (list) return list;
    if (!name.trim()) return null;
    setBusy(true);
    try {
      const created = await onCreateList(name.trim());
      setList(created);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveName() {
    if (!list) return;
    if (!name.trim() || name === list.name) return;
    setBusy(true);
    try {
      await onRenameList(list.id, name.trim());
      setList({ ...list, name: name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddItem() {
    if (!draft.trim()) return;
    const target = await ensureList();
    if (!target) return;
    setBusy(true);
    try {
      const item = await onCreateItem(target.id, draft.trim());
      setList({ ...target, items: [...target.items, item] });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(item: TodoItem) {
    if (!list) return;
    const next = !item.done;
    setList({ ...list, items: list.items.map((i) => (i.id === item.id ? { ...i, done: next } : i)) });
    try {
      await onUpdateItem(list.id, item.id, { done: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // revert on error
      setList((cur) =>
        cur ? { ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, done: !next } : i)) } : cur,
      );
    }
  }

  async function handleRemoveItem(item: TodoItem) {
    if (!list) return;
    setList({ ...list, items: list.items.filter((i) => i.id !== item.id) });
    try {
      await onDeleteItem(list.id, item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteList() {
    if (!list) return;
    setBusy(true);
    try {
      await onDeleteList(list.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const done = list?.items.filter((i) => i.done).length ?? 0;
  const total = list?.items.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New ToDo list" : "Edit ToDo list"}</DialogTitle>
          {!isNew && (
            <DialogDescription>
              {done} of {total} done · capped at {TODO_LIST_CAP}.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void handleSaveName()}
                placeholder="e.g. Sensors clean-up"
                autoFocus
              />
            </div>
          </div>

          {capReached && (
            <p className="text-xs text-warn">
              {TODO_LIST_CAP} of {TODO_LIST_CAP} lists used — delete one to free a slot.
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Items</Label>
            <div className="max-h-72 space-y-1 overflow-auto pr-1">
              {list?.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                >
                  <Checkbox
                    checked={item.done}
                    onCheckedChange={() => void handleToggle(item)}
                  />
                  <span
                    className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}
                  >
                    {item.body}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveItem(item)}
                    aria-label="Delete item"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(!list || list.items.length === 0) && (
                <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No items yet — add one below.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddItem();
                  }
                }}
                placeholder="Add an item…"
                disabled={capReached || (!list && !name.trim())}
              />
              <Button
                size="sm"
                onClick={() => void handleAddItem()}
                disabled={
                  busy || !draft.trim() || capReached || (!list && !name.trim())
                }
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {totalCount} of {TODO_LIST_CAP} lists used
          </span>
          {!isNew && (
            <Button variant="outline" onClick={() => void handleDeleteList()} disabled={busy}>
              Delete list
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
