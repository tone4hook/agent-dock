import * as React from "react";
import { STICKY_CAP, type StickyNote } from "@agent-dock/shared";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COLORS = ["#fff5b8", "#d8f0e6", "#f5d6d6", "#dfe6f5", "#f0e0c8"];

interface StickyEditDialogProps {
  open: boolean;
  initial?: StickyNote | null;
  totalCount: number;
  onClose: () => void;
  onSubmit: (input: { body: string; color: string; tag: string | null }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function StickyEditDialog({
  open,
  initial,
  totalCount,
  onClose,
  onSubmit,
  onDelete,
}: StickyEditDialogProps) {
  const isNew = !initial;
  const [body, setBody] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0]);
  const [tag, setTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setBody(initial?.body ?? "");
      setColor(initial?.color ?? COLORS[0]);
      setTag(initial?.tag ?? "");
      setError(null);
    }
  }, [open, initial]);

  async function handleSubmit() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ body: body.trim(), color, tag: tag.trim() || null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const capReached = isNew && totalCount >= STICKY_CAP;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "New sticky note" : "Edit sticky note"}</DialogTitle>
          <DialogDescription>
            Tiny reminder pinned to the Notes page top strip. Capped at {STICKY_CAP}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              autoFocus
              className="resize-none"
              style={{ background: color, color: "#1a1a1a" }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-md border-2",
                    c === color ? "border-foreground" : "border-border",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tag (optional)</Label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. WEB-VMS" />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {capReached && !initial && (
            <p className="text-xs text-warn">
              {STICKY_CAP} of {STICKY_CAP} stickies used — delete one to free a slot.
            </p>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {totalCount} of {STICKY_CAP} stickies used
          </span>
          {!isNew && onDelete && (
            <Button variant="outline" onClick={() => void handleDelete()} disabled={busy}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={busy || !body.trim() || capReached}
          >
            {isNew ? "Save sticky" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
