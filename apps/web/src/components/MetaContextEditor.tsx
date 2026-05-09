import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { MetaContext, MetaContextKind, MetaContextScope } from "@agent-dock/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createMetaContext,
  deleteMetaContext,
  listMetaContexts,
  updateMetaContext,
} from "@/lib/api";

interface Props {
  scopeType: MetaContextScope;
  scopeId: string;
  defaultKind?: MetaContextKind;
}

export function MetaContextEditor({ scopeType, scopeId, defaultKind = "manual" }: Props) {
  const [items, setItems] = React.useState<MetaContext[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, [scopeType, scopeId]);

  async function load() {
    setError(null);
    try {
      setItems(await listMetaContexts(scopeType, scopeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAdd() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const item = await createMetaContext({
        scopeType,
        scopeId,
        kind: defaultKind,
        bodyMd: draft.trim(),
      });
      setItems((cur) => [...cur, item]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(id: string, bodyMd: string) {
    setBusy(true);
    try {
      const updated = await updateMetaContext(id, bodyMd);
      setItems((cur) => cur.map((it) => (it.id === id ? updated : it)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deleteMetaContext(id);
      setItems((cur) => cur.filter((it) => it.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Meta-context</h3>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {items.map((item) => (
        <MetaContextCard
          key={item.id}
          item={item}
          onSave={(body) => handleSave(item.id, body)}
          onDelete={() => handleDelete(item.id)}
          busy={busy}
        />
      ))}

      <div className="rounded-md border border-dashed border-border bg-background p-3">
        <Textarea
          value={draft}
          placeholder="Add a manual note about this item — it joins the ContextPack when this thing is linked to a task."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button disabled={busy || !draft.trim()} onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}

function MetaContextCard({
  item,
  onSave,
  onDelete,
  busy,
}: {
  item: MetaContext;
  onSave: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
  busy: boolean;
}) {
  const [body, setBody] = React.useState(item.bodyMd);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    setBody(item.bodyMd);
  }, [item.bodyMd]);

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="text-xs uppercase text-muted-foreground">
          {item.kind} · updated {new Date(item.updatedAt).toLocaleString()}
        </span>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                disabled={busy}
                onClick={async () => {
                  await onSave(body);
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setBody(item.bodyMd);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="outline" disabled={busy} onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{item.bodyMd}</pre>
      )}
    </div>
  );
}
