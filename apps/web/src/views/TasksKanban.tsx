import * as React from "react";
import { Plus } from "lucide-react";
import type { Project } from "@agent-dock/shared";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KanbanColumn } from "@/components/tasks/KanbanColumn";
import { TaskKanbanFilters } from "@/components/tasks/TaskKanbanFilters";
import { createTask, listTasks, type TaskWithCounts } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface TasksKanbanProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  navigate: Navigate;
}

interface Buckets {
  open: TaskWithCounts[];
  inProgress: TaskWithCounts[];
  review: TaskWithCounts[];
  done: TaskWithCounts[];
}

const EMPTY: Buckets = { open: [], inProgress: [], review: [], done: [] };

const ALL = "__all__" as const;

export function TasksKanban({
  projects,
  activeProjectId,
  onSelectProject,
  navigate,
}: TasksKanbanProps) {
  // Project scope: ALL by default ("show me everything I have"), or a
  // specific project. Initialise from the workspace's active project so
  // navigating in via the sidebar still respects the user's selection.
  const initialScope: string = activeProjectId ?? ALL;
  const [scope, setScope] = React.useState<string>(initialScope);
  const scopedProject =
    scope === ALL ? null : projects.find((p) => p.id === scope) ?? null;
  const [tasks, setTasks] = React.useState<TaskWithCounts[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const filter = scope === ALL ? {} : { projectId: scope };
      setTasks(await listTasks(filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Refresh every 5s while any task has a live (non-terminal) session.
  const hasLive = tasks.some((t) => t.liveSession);
  React.useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [hasLive, load]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return tasks;
    const needle = query.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.descriptionMd ?? "").toLowerCase().includes(needle),
    );
  }, [tasks, query]);

  const buckets = React.useMemo(() => bucketize(filtered), [filtered]);

  // Pick a creation target: the scoped project if any, else the active
  // project, else the first project. Lets "+ New task" work even from
  // an "All projects" view.
  const creationProjectId =
    scopedProject?.id ?? activeProjectId ?? projects[0]?.id ?? null;

  async function handleCreate() {
    if (!creationProjectId || !draftTitle.trim()) return;
    setBusy(true);
    try {
      const task = await createTask({
        projectId: creationProjectId,
        title: draftTitle.trim(),
      });
      setDraftTitle("");
      setCreating(false);
      navigate({ view: "task-detail", taskId: task.id, edit: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleScopeChange(next: string) {
    setScope(next);
    if (next !== ALL) onSelectProject(next);
  }

  const headerSub =
    scopedProject != null
      ? `${scopedProject.defaultBaseRef} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}`
      : `All projects · ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;

  return (
    <>
      <TopBar
        title="Tasks"
        sub={headerSub}
        right={
          <>
            <Select value={scope} onValueChange={handleScopeChange}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TaskKanbanFilters query={query} onQueryChange={setQuery} />
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              disabled={creating || busy || !creationProjectId}
              title={
                creationProjectId
                  ? undefined
                  : "Pick a project (or discover one) before creating a task"
              }
            >
              <Plus className="h-4 w-4" />
              New task
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex h-full max-w-7xl flex-col px-5 py-5">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {creating && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-dashed border-border bg-card p-2">
            <Input
              autoFocus
              placeholder={`Task title — will land in ${
                projects.find((p) => p.id === creationProjectId)?.name ?? "the active project"
              }`}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setDraftTitle("");
                }
              }}
              className="h-8"
            />
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!draftTitle.trim() || busy || !creationProjectId}
            >
              Create
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCreating(false);
                setDraftTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="flex h-full min-h-0 gap-3">
          <KanbanColumn
            name="Open"
            tasks={buckets.open}
            navigate={navigate}
            onAddTask={() => setCreating(true)}
          />
          <KanbanColumn name="In progress" tasks={buckets.inProgress} navigate={navigate} />
          <KanbanColumn name="Review" tasks={buckets.review} navigate={navigate} />
          <KanbanColumn name="Done" tasks={buckets.done} navigate={navigate} />
        </div>
        </div>
      </div>
    </>
  );
}

function bucketize(tasks: TaskWithCounts[]): Buckets {
  const result: Buckets = { ...EMPTY, open: [], inProgress: [], review: [], done: [] };
  for (const t of tasks) {
    const live = t.liveSession;
    const inReview =
      t.status === "in_progress" &&
      (live?.status === "awaiting_approval" || live?.currentStepRole === "code_review");

    if (t.status === "open") {
      result.open.push(t);
    } else if (t.status === "in_progress" && inReview) {
      result.review.push(t);
    } else if (t.status === "in_progress") {
      result.inProgress.push(t);
    } else if (t.status === "done") {
      result.done.push(t);
    }
    // status === "abandoned" is intentionally hidden from the board.
  }
  return result;
}
