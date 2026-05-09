import { ChevronRight } from "lucide-react";
import { NoteSourceBadge } from "@/components/notes/NoteSourceBadge";
import type { NoteWithRelations } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface NoteCardProps {
  note: NoteWithRelations;
  navigate: Navigate;
}

export function NoteCard({ note, navigate }: NoteCardProps) {
  const preview = (note.body || "").slice(0, 240);
  return (
    <button
      type="button"
      onClick={() => navigate({ view: "note-detail", noteId: note.id })}
      className="flex flex-col rounded-md border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2">
        <NoteSourceBadge source={note.source} />
        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
          {timeAgo(note.updatedAt)}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-semibold">{note.title}</div>
      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
        {preview || "(no body)"}
      </p>
      {note.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          {note.tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{note.tags.length - 4}</span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px]">
        <span className="text-muted-foreground">
          {note.taskIds.length} tasks · {note.jiraKeys.length} jira · {note.pageIds.length} pages
        </span>
        <span className="inline-flex items-center text-muted-foreground">
          open <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function timeAgo(iso: string): string {
  const ts = iso.includes("T") ? new Date(iso).getTime() : new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ts)) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
