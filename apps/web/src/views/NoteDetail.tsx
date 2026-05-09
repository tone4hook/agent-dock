import * as React from "react";
import { ArrowLeft, Pencil, Save, Trash2, X } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { NoteSourceBadge } from "@/components/notes/NoteSourceBadge";
import {
  addNoteJiraLink,
  addNoteTag,
  addNoteTaskLink,
  deleteNote,
  getNote,
  removeNoteJiraLink,
  removeNoteTag,
  removeNoteTaskLink,
  updateNote,
  type NoteWithRelations,
} from "@/lib/api";
import type { Navigate, Route } from "@/lib/router";

interface NoteDetailProps {
  noteId: string;
  navigate: Navigate;
  onBack?: (fallback: Route) => void;
}

export function NoteDetail({ noteId, navigate, onBack }: NoteDetailProps) {
  const [note, setNote] = React.useState<NoteWithRelations | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftBody, setDraftBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const n = await getNote(noteId);
      setNote(n);
      setDraftTitle(n.title);
      setDraftBody(n.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleBack() {
    const fallback: Route = { view: "notes" };
    if (onBack) onBack(fallback);
    else navigate(fallback);
  }

  async function handleSave() {
    if (!note) return;
    setBusy(true);
    try {
      const next = await updateNote(note.id, { title: draftTitle.trim() || "Untitled", body: draftBody });
      setNote({ ...note, ...next });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!note) return;
    setBusy(true);
    try {
      await deleteNote(note.id);
      handleBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <TopBar title="Note" />
        <div className="flex-1 p-5">
          <Skeleton className="h-32" />
        </div>
      </>
    );
  }

  if (!note) {
    return (
      <>
        <TopBar title="Note" />
        <div className="flex-1 p-5">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error ?? "Note not found"}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{note.title}</span>
            <NoteSourceBadge source={note.source} />
          </span>
        }
        sub={`Note · updated ${formatDate(note.updatedAt)}`}
        right={
          <>
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setDraftTitle(note.title);
                    setDraftBody(note.body);
                  }}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={busy}>
                  <Save className="h-4 w-4" />
                  Save
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void handleDelete()} disabled={busy}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto grid max-w-5xl gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-3">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="rounded-md border border-border bg-card p-4">
              {editing ? (
                <div className="space-y-3">
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Title"
                    className="text-lg font-semibold"
                  />
                  <Textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={18}
                    placeholder="Markdown body…"
                    className="font-mono text-sm"
                  />
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold leading-tight">{note.title}</h1>
                  <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap text-sm font-sans leading-relaxed">
                    {note.body || "(empty)"}
                  </pre>
                </>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <SidebarCard title="Source">
              <div className="text-sm">{note.source === "chat_response" ? "Saved from chat" : "Manual"}</div>
              {note.chatMessageId && (
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  msg: {note.chatMessageId}
                </div>
              )}
            </SidebarCard>

            <LinksCard
              note={note}
              onChange={(next) => setNote(next)}
            />

            <TagsCard note={note} onChange={(next) => setNote(next)} />

            <SidebarCard title="Activity">
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>updated {formatDate(note.updatedAt)}</div>
                <div>created {formatDate(note.createdAt)}</div>
              </div>
            </SidebarCard>
          </aside>
        </div>
      </div>
    </>
  );
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function LinksCard({
  note,
  onChange,
}: {
  note: NoteWithRelations;
  onChange: (next: NoteWithRelations) => void;
}) {
  const [jiraDraft, setJiraDraft] = React.useState("");
  const [taskDraft, setTaskDraft] = React.useState("");

  return (
    <SidebarCard title="Links">
      <div className="space-y-2 text-xs">
        <div>
          <div className="mb-1 font-medium">Jira</div>
          {note.jiraKeys.length === 0 ? (
            <div className="text-muted-foreground">none</div>
          ) : (
            <ul className="space-y-1">
              {note.jiraKeys.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{k}</span>
                  <button
                    type="button"
                    onClick={async () => onChange(await removeNoteJiraLink(note.id, k))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex gap-1">
            <Input
              value={jiraDraft}
              onChange={(e) => setJiraDraft(e.target.value)}
              placeholder="EEPD-123"
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!jiraDraft.trim()}
              onClick={async () => {
                const next = await addNoteJiraLink(note.id, jiraDraft.trim());
                onChange(next);
                setJiraDraft("");
              }}
            >
              Link
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1 font-medium">Task</div>
          {note.taskIds.length === 0 ? (
            <div className="text-muted-foreground">none</div>
          ) : (
            <ul className="space-y-1">
              {note.taskIds.map((t) => (
                <li key={t} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{t.slice(0, 8)}…</span>
                  <button
                    type="button"
                    onClick={async () => onChange(await removeNoteTaskLink(note.id, t))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex gap-1">
            <Input
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              placeholder="task-id"
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!taskDraft.trim()}
              onClick={async () => {
                const next = await addNoteTaskLink(note.id, taskDraft.trim());
                onChange(next);
                setTaskDraft("");
              }}
            >
              Link
            </Button>
          </div>
        </div>

        {note.pageIds.length > 0 && (
          <div>
            <div className="mb-1 font-medium">Confluence</div>
            <ul className="space-y-1">
              {note.pageIds.map((p) => (
                <li key={p} className="font-mono">{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SidebarCard>
  );
}

function TagsCard({
  note,
  onChange,
}: {
  note: NoteWithRelations;
  onChange: (next: NoteWithRelations) => void;
}) {
  const [draft, setDraft] = React.useState("");
  return (
    <SidebarCard title="Tags">
      <div className="flex flex-wrap gap-1">
        {note.tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">none</span>
        ) : (
          note.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px]"
            >
              {t}
              <button
                type="button"
                onClick={async () => onChange(await removeNoteTag(note.id, t))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="tag"
          className="h-7 text-xs"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && draft.trim()) {
              const next = await addNoteTag(note.id, draft.trim());
              onChange(next);
              setDraft("");
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!draft.trim()}
          onClick={async () => {
            const next = await addNoteTag(note.id, draft.trim());
            onChange(next);
            setDraft("");
          }}
        >
          Add
        </Button>
      </div>
    </SidebarCard>
  );
}

function formatDate(iso: string): string {
  const ts = iso.includes("T") ? new Date(iso) : new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return iso;
  return ts.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
