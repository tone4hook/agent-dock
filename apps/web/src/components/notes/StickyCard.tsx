import type { StickyNote } from "@agent-dock/shared";

interface StickyCardProps {
  sticky: StickyNote;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}

const TILT = ["-rotate-1", "rotate-1", "-rotate-2"];

export function StickyCard({ sticky, index, onEdit, onDelete }: StickyCardProps) {
  return (
    <div
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEdit();
      }}
      className={`group flex min-h-[7rem] flex-1 cursor-pointer flex-col rounded-md p-3 text-zinc-900 shadow-sm transition-transform hover:scale-[1.02] ${TILT[index % TILT.length]}`}
      style={{ background: sticky.color }}
    >
      <div className="flex-1 text-sm font-medium leading-snug">{sticky.body}</div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        {sticky.tag ? (
          <span className="rounded-sm bg-white/60 px-1.5 py-0.5 font-mono text-zinc-700">
            {sticky.tag}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 transition-opacity hover:underline group-hover:opacity-100"
        >
          delete
        </button>
      </div>
    </div>
  );
}
