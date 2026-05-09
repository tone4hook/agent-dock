import React from "react";
import { ArrowLeft, Pencil, Play, Trash2, X } from "lucide-react";
import type { TaskStatus } from "@agent-dock/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MetaContextEditor } from "@/components/MetaContextEditor";
import { TopBar } from "@/components/TopBar";
import { TaskJiraLinker } from "@/components/TaskJiraLinker";
import { TaskConfluenceLinker } from "@/components/TaskConfluenceLinker";
import { TaskSessionsList } from "@/components/TaskSessionsList";
import {
  deleteTask,
  getTask,
  removeTaskConfluenceLink,
  removeTaskJiraLink,
  startSession,
  type TaskDetail,
  updateTask,
} from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface Props {
  navigate: Navigate;
  taskId: string;
  /**
   * When true (set by the TaskList "New task" flow via the router),
   * the page opens in edit mode immediately. Existing tasks always
   * open read-only.
   */
  startInEditMode?: boolean;
}

const STATUS_OPTIONS: TaskStatus[] = ["open", "in_progress", "done", "abandoned"];

export function TaskDetailView({ navigate, taskId, startInEditMode = false }: Props) {
  const [task, setTask] = React.useState<TaskDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(startInEditMode);

  // Local form state for editable fields; pushed via Save.
  const [title, setTitle] = React.useState("");
  const [descriptionMd, setDescriptionMd] = React.useState("");
  const [baseRefOverride, setBaseRefOverride] = React.useState<string>("");
  const [status, setStatus] = React.useState<TaskStatus>("open");

  React.useEffect(() => {
    void load();
  }, [taskId]);

  async function load() {
    setError(null);
    try {
      const t = await getTask(taskId);
      setTask(t);
      setTitle(t.title);
      setDescriptionMd(t.descriptionMd);
      setBaseRefOverride(t.baseRefOverride ?? "");
      setStatus(t.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function persist() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateTask(task.id, {
        title: title.trim() || task.title,
        descriptionMd,
        baseRefOverride: baseRefOverride.trim() || null,
        status,
      });
      setTask(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    if (!task) return;
    setTitle(task.title);
    setDescriptionMd(task.descriptionMd);
    setBaseRefOverride(task.baseRefOverride ?? "");
    setStatus(task.status);
    setEditing(false);
  }

  async function handleStartSession() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startSession(task.id);
      navigate({ view: "session-detail", sessionId: result.sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm(`Delete task "${task.title}"? Linked Jira/Confluence cache rows will be kept.`)) return;
    setBusy(true);
    try {
      await deleteTask(task.id);
      navigate({ view: "dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!task) {
    return (
      <div className="min-h-screen p-8 text-sm text-muted-foreground">
        {error ?? "Loading…"}
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{task.title}</span>
            <Badge>{task.status}</Badge>
          </span>
        }
        sub="Task"
        right={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate({ view: "dashboard" })}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {!editing ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
            <Button size="sm" disabled={busy} onClick={handleStartSession}>
              <Play className="h-4 w-4" />
              Start
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-auto">
        <main className="mx-auto max-w-5xl space-y-4 px-5 py-5">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Details</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                  Title
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                  Description (markdown)
                  <Textarea
                    value={descriptionMd}
                    onChange={(e) => setDescriptionMd(e.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                    Status
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                    Base ref override
                    <Input
                      placeholder="(use project default)"
                      value={baseRefOverride}
                      onChange={(e) => setBaseRefOverride(e.target.value)}
                    />
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={busy} onClick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button disabled={busy} onClick={persist}>
                    Save changes
                  </Button>
                </div>
              </>
            ) : (
              <>
                <ReadOnlyField label="Title" value={task.title} />
                <ReadOnlyField
                  label="Description (markdown)"
                  value={task.descriptionMd || "(none)"}
                  preformat
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Status" value={task.status} />
                  <ReadOnlyField
                    label="Base ref override"
                    value={task.baseRefOverride ?? "(use project default)"}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Sessions ({task.sessionsCount})</h2>
          </CardHeader>
          <CardContent>
            <TaskSessionsList taskId={task.id} navigate={navigate} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Jira links ({task.jiraLinks.length})</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {task.jiraLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Jira issues linked yet. Link any locally-saved issue below.
              </p>
            ) : (
              task.jiraLinks.map((link) => (
                <div
                  key={link.jiraKey}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate({ view: "jira-detail", key: link.jiraKey })}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{link.jiraKey}</span>
                      {link.status ? <Badge>{link.status}</Badge> : null}
                      {link.role ? <Badge>{link.role}</Badge> : null}
                    </div>
                    {link.summary ? (
                      <p className="mt-1 truncate text-sm text-muted-foreground">{link.summary}</p>
                    ) : null}
                  </button>
                  {editing ? (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const next = await removeTaskJiraLink(task.id, link.jiraKey);
                        setTask(next);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))
            )}
            {editing ? (
              <TaskJiraLinker
                taskId={task.id}
                existingKeys={task.jiraLinks.map((l) => l.jiraKey)}
                onChanged={setTask}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">
              Confluence links ({task.confluenceLinks.length})
            </h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {task.confluenceLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Confluence pages linked yet. Link any locally-saved page below.
              </p>
            ) : (
              task.confluenceLinks.map((link) => (
                <div
                  key={link.pageId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate({ view: "confluence-detail", id: link.pageId })}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{link.title ?? link.pageId}</span>
                      {link.role ? <Badge>{link.role}</Badge> : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {link.pageId}
                    </p>
                  </button>
                  {editing ? (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const next = await removeTaskConfluenceLink(task.id, link.pageId);
                        setTask(next);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))
            )}
            {editing ? (
              <TaskConfluenceLinker
                taskId={task.id}
                existingIds={task.confluenceLinks.map((l) => l.pageId)}
                onChanged={setTask}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <MetaContextEditor scopeType="task" scopeId={task.id} />
          </CardContent>
        </Card>
        </main>
      </div>
    </>
  );
}

function ReadOnlyField({
  label,
  value,
  preformat,
}: {
  label: string;
  value: string;
  preformat?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      {preformat ? (
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          {value}
        </pre>
      ) : (
        <span className="text-sm">{value}</span>
      )}
    </div>
  );
}
