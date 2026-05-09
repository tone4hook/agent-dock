import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/api";
import { WELCOME_TABS } from "@/components/welcome/welcomeContent";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const firstTabId = WELCOME_TABS[0]?.id ?? "";
  const [tab, setTab] = React.useState<string>(firstTabId);
  const [viewed, setViewed] = React.useState<Set<string>>(() => new Set([firstTabId]));
  const [dontShow, setDontShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Reset internal state every time the modal re-opens, so a user who
  // re-opens it from Settings gets a fresh "view all tabs to continue"
  // gate instead of inheriting last session's state.
  React.useEffect(() => {
    if (!open) return;
    setTab(firstTabId);
    setViewed(new Set([firstTabId]));
    setDontShow(false);
  }, [open, firstTabId]);

  const canClose = viewed.size === WELCOME_TABS.length;

  function handleTabChange(next: string) {
    setTab(next);
    setViewed((cur) => {
      if (cur.has(next)) return cur;
      const updated = new Set(cur);
      updated.add(next);
      return updated;
    });
  }

  async function handleClose() {
    if (!canClose || busy) return;
    if (dontShow) {
      setBusy(true);
      try {
        const cur = await getRuntimeSettings();
        await updateRuntimeSettings({ ...cur, welcomeDismissed: true });
      } catch {
        // Persisting the dismissal is best-effort: closing the modal is
        // never blocked by a settings round-trip failure. The modal will
        // re-appear on next launch, which is the safer default.
      } finally {
        setBusy(false);
      }
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Only honor an external "close" when the gate is satisfied.
        // Esc / overlay clicks on Radix Dialog also flow through here, so
        // this is the single point that prevents premature dismissal.
        if (!next && canClose) void handleClose();
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(e) => {
          if (!canClose) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!canClose) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!canClose) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Welcome to Agent*Dock</DialogTitle>
          <DialogDescription>
            A 30-second tour. View each tab to continue.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={handleTabChange} className="mt-2">
          <TabsList>
            {WELCOME_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
                {viewed.has(t.id) && <span className="ml-1 text-[10px]">✓</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          {WELCOME_TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-4">
              <h3 className="text-sm font-semibold">{t.title}</h3>
              <div className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {t.body}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <DialogFooter className="mt-4 sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(v === true)}
            />
            Don't show this again
          </label>
          <div className="flex items-center gap-2">
            {!canClose && (
              <span className="text-xs text-muted-foreground">
                View each tab to continue ({viewed.size}/{WELCOME_TABS.length})
              </span>
            )}
            <Button onClick={() => void handleClose()} disabled={!canClose || busy}>
              {busy ? "Saving…" : "Close"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
