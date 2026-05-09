import { TopBar } from "@/components/TopBar";

interface ComingSoonProps {
  title: string;
  phase: number;
  description: string;
}

export function ComingSoon({ title, phase, description }: ComingSoonProps) {
  return (
    <>
      <TopBar title={title} sub={`Phase ${phase} placeholder`} />
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-md rounded-md border border-dashed border-border bg-card p-8 text-center text-card-foreground">
          <div className="text-2xl font-semibold">{title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
            Coming in phase {phase}
          </p>
        </div>
      </div>
    </>
  );
}
