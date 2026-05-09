import React from "react";
import { Folder } from "lucide-react";
import { AtlassianCredsForm } from "@/components/AtlassianCredsForm";
import { BrandIcon } from "@/components/BrandIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { pickWorkspaceFolder, setWorkspaceDir, type WorkspaceState } from "@/lib/api";


interface OnboardingProps {
  onComplete: (state: WorkspaceState) => void;
}

type Step = "workspace" | "atlassian";

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = React.useState<Step>("workspace");
  const [workspaceState, setWorkspaceState] = React.useState<WorkspaceState | null>(null);
  const [dir, setDir] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function pickViaNeutralino() {
    setError(null);
    try {
      const picked = await pickWorkspaceFolder();
      if (picked) setDir(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWorkspaceContinue() {
    if (!dir.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const state = await setWorkspaceDir(dir.trim());
      setWorkspaceState(state);
      setStep("atlassian");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleFinish() {
    if (workspaceState) onComplete(workspaceState);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-5 py-16">
        <div className="mb-8 flex items-center gap-3">
          <BrandIcon className="h-10 w-10 shrink-0 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Welcome to Agent*Dock</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Two quick steps and you're set up.
              <span className="ml-2 font-mono text-xs">
                Step {step === "workspace" ? "1" : "2"} of 2
              </span>
            </p>
          </div>
        </div>

        {step === "workspace" ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold">Step 1 — Workspace directory</h2>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Pick a parent directory containing your git repos. Agent*Dock auto-discovers
                first-level git repositories. Worktrees will be created at{" "}
                <code>&lt;workspace&gt;/worktrees/</code>.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={dir}
                  placeholder="/Users/you/Code"
                  onChange={(e) => setDir(e.target.value)}
                />
                <Button variant="outline" onClick={pickViaNeutralino}>
                  <Folder className="h-4 w-4" />
                  Browse
                </Button>
              </div>
              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button disabled={busy || !dir.trim()} onClick={handleWorkspaceContinue}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold">Step 2 — Atlassian (optional)</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <AtlassianCredsForm />
              <div className="flex justify-end">
                <Button onClick={handleFinish}>Finish</Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                You can add or change credentials later in Settings.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
