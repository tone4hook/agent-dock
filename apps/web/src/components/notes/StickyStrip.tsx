import { Plus } from "lucide-react";
import { STICKY_CAP, type StickyNote } from "@agent-dock/shared";
import { StickyCard } from "@/components/notes/StickyCard";

interface StickyStripProps {
  stickies: StickyNote[];
  onEdit: (sticky: StickyNote) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function StickyStrip({ stickies, onEdit, onDelete, onAdd }: StickyStripProps) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold">Sticky notes</h2>
        <span className="text-xs text-muted-foreground">
          {stickies.length} / {STICKY_CAP} · cap
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {stickies.map((s, i) => (
          <StickyCard
            key={s.id}
            sticky={s}
            index={i}
            onEdit={() => onEdit(s)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
        {stickies.length < STICKY_CAP && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-[7rem] flex-1 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Add sticky ({STICKY_CAP - stickies.length} left)
          </button>
        )}
      </div>
    </section>
  );
}
