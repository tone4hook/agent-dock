import { ChevronRight, FileText, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConfluenceSearchHit } from "@/lib/api";
import type { Navigate } from "@/lib/router";

interface PageRowProps {
  page: ConfluenceSearchHit;
  saved?: boolean;
  navigate: Navigate;
}

export function PageRow({ page, saved, navigate }: PageRowProps) {
  return (
    <button
      type="button"
      onClick={() => navigate({ view: "confluence-detail", id: page.id })}
      className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{page.title || "(untitled)"}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {page.spaceKey ?? "—"}
          {page.updatedAt ? ` · updated ${formatDateShort(page.updatedAt)}` : ""}
        </div>
      </div>
      {saved ? (
        <Badge>
          <Star className="h-3 w-3" /> saved
        </Badge>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function formatDateShort(iso: string): string {
  const ts = iso.includes("T") ? new Date(iso) : new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return iso;
  return ts.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
