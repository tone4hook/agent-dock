import * as React from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listSavedJira, listTasks, createNoteFromChatMessage, type ChatMessage } from "@/lib/api";
import type { TaskWithCounts } from "@/lib/api";

interface SaveAsNoteDialogProps {
  open: boolean;
  message: ChatMessage | null;
  projectId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveAsNoteDialog({
  open,
  message,
  projectId,
  onClose,
  onSaved,
}: SaveAsNoteDialogProps) {
  const [title, setTitle] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [taskIds, setTaskIds] = React.useState<string[]>([]);
  const [jiraKeys, setJiraKeys] = React.useState<string[]>([]);
  const [tasks, setTasks] = React.useState<TaskWithCounts[]>([]);
  const [savedJira, setSavedJira] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !message) return;
    setTitle(deriveTitle(message.content));
    setTags([]);
    setTagDraft("");
    setTaskIds([]);
    setJiraKeys([]);
    setError(null);
    void Promise.all([listTasks(), listSavedJira()])
      .then(([t, j]) => {
        setTasks(t);
        setSavedJira(j);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, message]);

  function toggleTask(id: string) {
    setTaskIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }
  function toggleJira(key: string) {
    setJiraKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }
  function addTag() {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagDraft("");
  }

  async function save() {
    if (!message) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createNoteFromChatMessage({
        chatMessageId: message.id,
        title: title.trim(),
        body: message.content,
        projectId,
        tags: tags.length > 0 ? tags : undefined,
        taskIds: taskIds.length > 0 ? taskIds : undefined,
        jiraKeys: jiraKeys.length > 0 ? jiraKeys : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Save as note</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Link to task</span>
            <div className="flex flex-wrap gap-1">
              {tasks.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tasks</span>
              ) : (
                tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTask(t.id)}
                    className={chipCls(taskIds.includes(t.id))}
                  >
                    {t.title}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Link to Jira</span>
            <div className="flex flex-wrap gap-1">
              {savedJira.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No saved Jira issues. Save one from the Jira pages first.
                </span>
              ) : (
                savedJira.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleJira(k)}
                    className={chipCls(jiraKeys.includes(k))}
                  >
                    {k}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Tags</span>
            <div className="flex flex-wrap items-center gap-1">
              {tags.map((t) => (
                <Badge key={t} className="gap-1 pr-1">
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add tag…"
                className="h-7 w-32 text-xs"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !message}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function chipCls(active: boolean): string {
  return [
    "h-7 rounded-full border px-3 text-xs transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background hover:bg-accent",
  ].join(" ");
}

function deriveTitle(body: string): string {
  // Prefer first H2 ("## …") then first line, capped at 200 chars.
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const h2 = lines.find((l) => l.startsWith("## "));
  const candidate = h2 ? h2.replace(/^#+\s*/, "") : lines[0] ?? "Saved chat response";
  return candidate.slice(0, 200);
}
