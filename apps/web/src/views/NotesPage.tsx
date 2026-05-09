import * as React from "react";
import { Plus } from "lucide-react";
import type { Project, StickyNote } from "@agent-dock/shared";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { NoteFilters, type NoteSortOrder, type NoteSourceFilter } from "@/components/notes/NoteFilters";
import { NotesGrid } from "@/components/notes/NotesGrid";
import { StickyEditDialog } from "@/components/notes/StickyEditDialog";
import { StickyStrip } from "@/components/notes/StickyStrip";
import { TodoEditDialog, type TodoListWithItems } from "@/components/notes/TodoEditDialog";
import { TodoListsRow } from "@/components/notes/TodoListsRow";
import {
  createNote,
  createSticky,
  createTodoItem,
  createTodoList,
  deleteSticky,
  deleteTodoItem,
  deleteTodoList,
  listNotes,
  listStickies,
  listTodoLists,
  updateSticky,
  updateTodoItem,
  updateTodoList,
  type NoteWithRelations,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface NotesPageProps {
  projects: Project[];
  navigate: Navigate;
}

export function NotesPage({ projects, navigate }: NotesPageProps) {
  const [stickies, setStickies] = React.useState<StickyNote[]>([]);
  const [todoLists, setTodoLists] = React.useState<TodoListWithItems[]>([]);
  const [notes, setNotes] = React.useState<NoteWithRelations[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [stickyOpen, setStickyOpen] = React.useState(false);
  const [stickyEditing, setStickyEditing] = React.useState<StickyNote | null>(null);
  const [todoOpen, setTodoOpen] = React.useState(false);
  const [todoEditing, setTodoEditing] = React.useState<TodoListWithItems | null>(null);

  // Filters
  const [source, setSource] = React.useState<NoteSourceFilter>("all");
  const [projectFilter, setProjectFilter] = React.useState<string | "all">("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<NoteSortOrder>("updated");

  const loadAll = React.useCallback(async () => {
    setError(null);
    try {
      const [s, l, n] = await Promise.all([
        listStickies(),
        listTodoLists(),
        listNotes({
          source: source === "all" ? undefined : source,
          projectId: projectFilter === "all" ? undefined : projectFilter,
          q: query.trim() || undefined,
        }),
      ]);
      setStickies(s);
      setTodoLists(l);
      // Server already orders by updated DESC; tweak if user picked "created".
      const sorted = sort === "created" ? [...n].sort(byCreatedDesc) : n;
      setNotes(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [source, projectFilter, query, sort]);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Sticky handlers
  function openNewSticky() {
    setStickyEditing(null);
    setStickyOpen(true);
  }
  function openExistingSticky(s: StickyNote) {
    setStickyEditing(s);
    setStickyOpen(true);
  }
  async function handleStickySubmit(input: { body: string; color: string; tag: string | null }) {
    if (stickyEditing) {
      await updateSticky(stickyEditing.id, input);
    } else {
      await createSticky(input);
    }
    await loadAll();
  }
  async function handleStickyDelete() {
    if (!stickyEditing) return;
    await deleteSticky(stickyEditing.id);
    await loadAll();
  }
  async function handleStickyDeleteFromCard(id: string) {
    await deleteSticky(id);
    await loadAll();
  }

  // Todo handlers
  function openNewTodo() {
    setTodoEditing(null);
    setTodoOpen(true);
  }
  function openExistingTodo(l: TodoListWithItems) {
    setTodoEditing(l);
    setTodoOpen(true);
  }

  async function handleNewNote() {
    try {
      const note = await createNote({
        source: "manual",
        title: "Untitled note",
        body: "",
        projectId: projectFilter === "all" ? null : projectFilter,
      });
      navigate({ view: "note-detail", noteId: note.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <TopBar
        title="Notes"
        sub="Sticky reminders · ToDo lists · Notes (manual + saved chat responses)"
        right={
          <>
            <Button variant="outline" size="sm" onClick={openNewSticky}>
              <Plus className="h-4 w-4" />
              Sticky
            </Button>
            <Button variant="outline" size="sm" onClick={openNewTodo}>
              <Plus className="h-4 w-4" />
              ToDo list
            </Button>
            <Button size="sm" onClick={() => void handleNewNote()}>
              <Plus className="h-4 w-4" />
              New note
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-5">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <StickyStrip
            stickies={stickies}
            onAdd={openNewSticky}
            onEdit={openExistingSticky}
            onDelete={(id) => void handleStickyDeleteFromCard(id)}
          />

          <TodoListsRow
            lists={todoLists}
            onAdd={openNewTodo}
            onEdit={openExistingTodo}
          />

          <section>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-semibold">Notes</h2>
              <NoteFilters
                source={source}
                onSourceChange={setSource}
                projectId={projectFilter}
                onProjectChange={setProjectFilter}
                projects={projects}
                query={query}
                onQueryChange={setQuery}
                sort={sort}
                onSortChange={setSort}
              />
            </div>
            <NotesGrid notes={notes} navigate={navigate} />
          </section>
        </div>
      </div>

      <StickyEditDialog
        open={stickyOpen}
        initial={stickyEditing}
        totalCount={stickies.length}
        onClose={() => setStickyOpen(false)}
        onSubmit={handleStickySubmit}
        onDelete={stickyEditing ? handleStickyDelete : undefined}
      />

      <TodoEditDialog
        open={todoOpen}
        initial={todoEditing}
        totalCount={todoLists.length}
        onClose={async () => {
          setTodoOpen(false);
          await loadAll();
        }}
        onCreateList={async (name) => {
          const created = await createTodoList({ name });
          await loadAll();
          return created;
        }}
        onRenameList={async (id, name) => {
          await updateTodoList(id, { name });
        }}
        onDeleteList={async (id) => {
          await deleteTodoList(id);
          await loadAll();
        }}
        onCreateItem={async (listId, body) => createTodoItem(listId, { body })}
        onUpdateItem={async (listId, itemId, patch) => {
          await updateTodoItem(listId, itemId, patch);
        }}
        onDeleteItem={async (listId, itemId) => {
          await deleteTodoItem(listId, itemId);
        }}
      />
    </>
  );
}

function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}
