import React from "react";
import { Sparkles, X } from "lucide-react";
import type { MetaContextScope, Project } from "@agent-dock/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelExploration,
  createMetaContext,
  explorationEventStreamUrl,
  forgetExploration,
  listProjects,
  startExploration,
  type ExplorationSnapshot,
} from "@/lib/api";

interface Props {
  scopeType: MetaContextScope;
  scopeId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const DEFAULT_PROMPT_BY_SCOPE: Record<MetaContextScope, string> = {
  jira: "Read this codebase and produce a brief that helps another agent plan work for the linked Jira issue. Focus on the directories and files most likely relevant.",
  confluence: "Read this codebase and produce a brief that grounds the linked Confluence page in the actual code: which modules implement the things the page describes.",
  task: "Read this codebase and produce a brief that helps another agent plan this task. Focus on relevant files and any conventions that matter.",
  project: "Produce a project orientation brief: top-level layout, key entry points, conventions, and where to start when adding new features.",
};

export function HaikuExploreDialog({ scopeType, scopeId, open, onClose, onSaved }: Props) {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectId, setProjectId] = React.useState<string>("");
  const [prompt, setPrompt] = React.useState(DEFAULT_PROMPT_BY_SCOPE[scopeType]);
  const [snap, setSnap] = React.useState<ExplorationSnapshot | null>(null);
  const [liveLog, setLiveLog] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sourceRef = React.useRef<EventSource | null>(null);

  React.useEffect(() => {
    if (!open) return;
    void listProjects()
      .then((ps) => {
        setProjects(ps);
        if (!projectId && ps[0]) setProjectId(ps[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open]);

  React.useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  function closeStream() {
    sourceRef.current?.close();
    sourceRef.current = null;
  }

  async function handleStart() {
    if (!projectId || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setLiveLog([]);
    try {
      const next = await startExploration({ prompt: prompt.trim(), scopeType, scopeId, projectId });
      setSnap(next);
      attachStream(next.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function attachStream(id: string) {
    closeStream();
    const source = new EventSource(explorationEventStreamUrl(id));
    sourceRef.current = source;
    const onEvent = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { kind: string; payload: unknown };
        if (data.kind === "agent" && isMessageEvent(data.payload)) {
          appendLog(`assistant: ${truncate(data.payload.text, 200)}`);
        } else if (data.kind === "agent" && isToolUseEvent(data.payload)) {
          appendLog(`tool: ${data.payload.name}`);
        } else if (data.kind === "stderr") {
          appendLog(`stderr: ${truncate(getLine(data.payload), 200)}`);
        } else if (data.kind === "status") {
          const status = (data.payload as { status?: string })?.status ?? "?";
          appendLog(`status: ${status}`);
          if (status === "completed" || status === "failed" || status === "cancelled") {
            void refreshSnap(id);
            closeStream();
          }
        }
      } catch {
        // ignore malformed
      }
    };
    for (const t of ["agent", "stderr", "status"]) source.addEventListener(t, onEvent);
  }

  function appendLog(line: string) {
    setLiveLog((cur) => [...cur.slice(-99), line]);
  }

  async function refreshSnap(id: string) {
    try {
      const next = await fetch(`${explorationEventStreamUrl(id).replace("/events", "")}`).then((r) =>
        r.json(),
      );
      setSnap(next as ExplorationSnapshot);
    } catch {
      // ignore
    }
  }

  async function handleCancel() {
    if (!snap) return;
    await cancelExploration(snap.id).catch(() => {});
    closeStream();
  }

  async function handleSave() {
    if (!snap || !snap.markdown) return;
    setBusy(true);
    setError(null);
    try {
      await createMetaContext({
        scopeType: snap.scopeType,
        scopeId: snap.scopeId,
        kind: "haiku_explored",
        bodyMd: snap.markdown,
      });
      await forgetExploration(snap.id);
      onSaved?.();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    closeStream();
    if (snap?.status === "completed" || snap?.status === "cancelled" || snap?.status === "failed") {
      void forgetExploration(snap.id).catch(() => {});
    }
    setSnap(null);
    setLiveLog([]);
    setPrompt(DEFAULT_PROMPT_BY_SCOPE[scopeType]);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Explore with Haiku</h2>
            {snap ? <Badge>{snap.status}</Badge> : null}
          </div>
          <Button variant="outline" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {!snap ? (
            <>
              <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                Project (working directory)
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.rootPath}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
                Prompt
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>
              <p className="text-xs text-muted-foreground">
                Haiku runs read-only against the chosen project (Read/Grep/Glob/WebFetch only).
                Output is markdown that you can review and save as a meta-context.
              </p>
            </>
          ) : (
            <>
              <div>
                <h3 className="text-xs uppercase text-muted-foreground">Live events</h3>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-background p-2 text-xs">
                  {liveLog.length ? liveLog.join("\n") : "(streaming…)"}
                </pre>
              </div>
              <div>
                <h3 className="text-xs uppercase text-muted-foreground">Markdown</h3>
                <Textarea
                  className="min-h-[18rem]"
                  value={snap.markdown}
                  onChange={(e) => setSnap({ ...snap, markdown: e.target.value })}
                />
              </div>
              {snap.errorMessage ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {snap.errorMessage}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          {!snap ? (
            <Button disabled={busy || !projectId || !prompt.trim()} onClick={handleStart}>
              <Sparkles className="h-4 w-4" />
              Run
            </Button>
          ) : snap.status === "running" ? (
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Discard
              </Button>
              <Button disabled={busy || !snap.markdown.trim()} onClick={handleSave}>
                Save as meta-context
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function isMessageEvent(p: unknown): p is { type: "message"; role: string; text?: string; delta?: boolean } {
  return !!p && typeof p === "object" && (p as { type?: string }).type === "message";
}
function isToolUseEvent(p: unknown): p is { type: "tool_use"; name: string } {
  return !!p && typeof p === "object" && (p as { type?: string }).type === "tool_use";
}
function getLine(p: unknown): string {
  return p && typeof p === "object" ? String((p as { line?: unknown }).line ?? "") : "";
}
function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
