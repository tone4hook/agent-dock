import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addTaskConfluenceLink,
  listSavedConfluence,
  type TaskDetail,
} from "@/lib/api";

interface Props {
  taskId: string;
  existingIds: string[];
  onChanged: (next: TaskDetail) => void;
}

export function TaskConfluenceLinker({ taskId, existingIds, onChanged }: Props) {
  const [savedIds, setSavedIds] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [role, setRole] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void listSavedConfluence()
      .then((pages) => setSavedIds(pages.map((p) => p.id)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const candidates = savedIds.filter((id) => !existingIds.includes(id));

  async function handleAdd() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await addTaskConfluenceLink(taskId, selected, role.trim());
      onChanged(next);
      setSelected("");
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— choose a saved Confluence page —</option>
          {candidates.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <Input
          placeholder="Role (e.g. spec, context)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <Button disabled={busy || !selected} onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          Link
        </Button>
      </div>
      {candidates.length === 0 && savedIds.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          All locally-saved Confluence pages are already linked to this task.
        </p>
      ) : null}
      {savedIds.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No saved Confluence pages yet. Save some from the Confluence pane first.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
