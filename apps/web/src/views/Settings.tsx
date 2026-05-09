import * as React from "react";
import { ArrowLeft, BookOpen, Folder, RefreshCcw, RotateCcw } from "lucide-react";
import type { RuntimeSettingsRecord } from "@agent-dock/shared";
import { AtlassianCredsForm } from "@/components/AtlassianCredsForm";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getRuntimeSettings,
  getWorkspaceState,
  rescanProjects,
  setWorkspaceDir,
  updateRuntimeSettings,
  type WorkspaceState,
} from "@/lib/api";

interface SettingsProps {
  onBack: () => void;
  onShowWelcome?: () => void;
}

export function Settings({ onBack, onShowWelcome }: SettingsProps) {
  return (
    <>
      <TopBar
        title="Settings"
        sub="Workspace, Atlassian credentials, and runtime preferences."
        right={
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />
      <div className="flex-1 overflow-auto">
        <main className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5">
          <WorkspaceSection />
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold">Atlassian Cloud</h2>
            </CardHeader>
            <CardContent>
              <AtlassianCredsForm />
            </CardContent>
          </Card>
          <ConcurrencySection />
          {onShowWelcome && <WelcomeGuideSection onShowWelcome={onShowWelcome} />}
        </main>
      </div>
    </>
  );
}

function WelcomeGuideSection({ onShowWelcome }: { onShowWelcome: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function resetDismissal() {
    setBusy(true);
    setError(null);
    try {
      const cur = await getRuntimeSettings();
      await updateRuntimeSettings({ ...cur, welcomeDismissed: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">Welcome guide</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Re-open the first-run tour, or reset it so it auto-shows on next launch.
        </p>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onShowWelcome}>
            <BookOpen className="h-4 w-4" />
            Show welcome guide
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resetDismissal()}>
            Reset dismissal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceSection() {
  const [state, setState] = React.useState<WorkspaceState | null>(null);
  const [dir, setDir] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(async () => {
    setError(null);
    try {
      const s = await getWorkspaceState();
      setState(s);
      setDir(s.workspaceDir ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void reset();
  }, [reset]);

  async function save() {
    if (!dir.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setWorkspaceDir(dir.trim());
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rescan() {
    setBusy(true);
    setError(null);
    try {
      setState(await rescanProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">Workspace</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Parent directory containing your git repos. Agent*Dock auto-discovers first-level
          repositories. Worktrees live at <code>&lt;workspace&gt;/worktrees/</code>.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="/Users/you/Code"
          />
          <Button variant="outline" disabled={busy} onClick={rescan}>
            <RefreshCcw className="h-4 w-4" />
            Rescan
          </Button>
        </div>
        {state?.projects && state.projects.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <Folder className="mr-1 inline h-3 w-3" />
            {state.projects.length} {state.projects.length === 1 ? "project" : "projects"} discovered.
          </p>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <SectionFooter onReset={reset} disabled={busy}>
          <Button disabled={busy || !dir.trim() || dir.trim() === state?.workspaceDir} onClick={save}>
            Save
          </Button>
        </SectionFooter>
      </CardContent>
    </Card>
  );
}

function ConcurrencySection() {
  const [settings, setSettings] = React.useState<RuntimeSettingsRecord | null>(null);
  const [draft, setDraft] = React.useState<number>(3);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(async () => {
    setError(null);
    try {
      const s = await getRuntimeSettings();
      setSettings(s);
      setDraft(s.maxConcurrentSessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void reset();
  }, [reset]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateRuntimeSettings({
        ...settings,
        maxConcurrentSessions: draft,
      });
      setSettings(next);
      setDraft(next.maxConcurrentSessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">Concurrency</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Maximum number of agent sessions allowed to run at once. Hard ceiling: 6.
        </p>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={1}
            max={6}
            value={draft}
            onChange={(e) => setDraft(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">
            (current: {settings?.maxConcurrentSessions ?? "…"})
          </span>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <SectionFooter onReset={reset} disabled={busy}>
          <Button
            disabled={busy || !settings || draft === settings.maxConcurrentSessions}
            onClick={save}
          >
            Save
          </Button>
        </SectionFooter>
      </CardContent>
    </Card>
  );
}

function SectionFooter({
  onReset,
  disabled,
  children,
}: {
  onReset: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onReset}>
        <RotateCcw className="h-4 w-4" />
        Reset
      </Button>
      {children}
    </div>
  );
}
