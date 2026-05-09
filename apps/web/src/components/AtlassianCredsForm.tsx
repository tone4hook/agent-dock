import React from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AtlassianStatus,
  clearAtlassianCreds,
  getAtlassianStatus,
  saveAtlassianCreds,
} from "@/lib/api";

interface Props {
  initialStatus?: AtlassianStatus;
  onSaved?: (status: AtlassianStatus) => void;
}

export function AtlassianCredsForm({ initialStatus, onSaved }: Props) {
  const [siteUrl, setSiteUrl] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [apiToken, setApiToken] = React.useState("");
  const [boardId, setBoardId] = React.useState("");
  const [status, setStatus] = React.useState<AtlassianStatus>(
    initialStatus ?? { connected: false, email: null, siteUrl: null, boardId: null },
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (initialStatus) return;
    void getAtlassianStatus()
      .then((s) => {
        setStatus(s);
        if (s.boardId) setBoardId(s.boardId);
      })
      .catch(() => {});
  }, [initialStatus]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const next = await saveAtlassianCreds({
        siteUrl: siteUrl.trim(),
        email: email.trim(),
        apiToken,
        boardId: boardId.trim() || null,
      });
      setStatus(next);
      setApiToken("");
      onSaved?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setError(null);
    try {
      const next = await clearAtlassianCreds();
      setStatus(next);
      setSiteUrl("");
      setEmail("");
      setApiToken("");
      setBoardId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setError(null);
    try {
      const next = await getAtlassianStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          Connected as <span className="font-mono">{status.email}</span>
          <span>·</span>
          <span className="font-mono">{status.siteUrl}</span>
          {status.boardId ? (
            <>
              <span>·</span>
              <span>board <span className="font-mono">{status.boardId}</span></span>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Atlassian Cloud only. Create an API token at{" "}
          <span className="font-mono">id.atlassian.com/manage-profile/security/api-tokens</span>.
          Tokens are stored in macOS Keychain — they never reach disk in plaintext.
        </p>
      )}

      <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
        Site URL
        <Input
          value={siteUrl}
          placeholder="https://your-co.atlassian.net"
          onChange={(e) => setSiteUrl(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
        Email
        <Input
          value={email}
          placeholder="you@your-co.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
        API token
        <Input
          type="password"
          value={apiToken}
          placeholder={status.connected ? "•••••••• (re-enter to rotate)" : ""}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium uppercase text-muted-foreground">
        Board ID <span className="font-normal normal-case text-[11px] text-muted-foreground">(optional — required for the Sprint tab)</span>
        <Input
          inputMode="numeric"
          value={boardId}
          placeholder="e.g. 42"
          onChange={(e) => setBoardId(e.target.value)}
        />
      </label>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !siteUrl || !email || !apiToken} onClick={handleSave}>
          <KeyRound className="h-4 w-4" />
          {status.connected ? "Update credentials" : "Save credentials"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={handleTest}>
          Test connection
        </Button>
        {status.connected ? (
          <Button variant="outline" disabled={busy} onClick={handleClear}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
