import { NoteCard } from "@/components/notes/NoteCard";
import type { NoteWithRelations } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface NotesGridProps {
  notes: NoteWithRelations[];
  navigate: Navigate;
}

export function NotesGrid({ notes, navigate }: NotesGridProps) {
  if (notes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No notes yet. Create one with "+ New note" or save a chat response from the Chat page.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} navigate={navigate} />
      ))}
    </div>
  );
}
