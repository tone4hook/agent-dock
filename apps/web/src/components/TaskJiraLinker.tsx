import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTaskJiraLink, listSavedJira, type TaskDetail } from "@/lib/api";

interface Props {
  taskId: string;
  existingKeys: string[];
  onChanged: (next: TaskDetail) => void;
}

export function TaskJiraLinker({ taskId, existingKeys, onChanged }: Props) {
  const [savedKeys, setSavedKeys] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [role, setRole] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void listSavedJira()
      .then(setSavedKeys)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const candidates = savedKeys.filter((k) => !existingKeys.includes(k));

  async function handleAdd() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await addTaskJiraLink(taskId, selected, role.trim());
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
          <option value="">— choose a saved Jira issue —</option>
          {candidates.map((k) => (
            <option key={k} value={k}>
              {k}
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
      {candidates.length === 0 && savedKeys.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          All locally-saved Jira issues are already linked to this task.
        </p>
      ) : null}
      {savedKeys.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No saved Jira issues yet. Save some from the Jira pane first.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
