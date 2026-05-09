import * as React from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker, modelSupportsReasoning } from "@/components/chat/ModelPicker";
import { EffortPicker } from "@/components/chat/EffortPicker";
import type { ChatModel, ReasoningEffort } from "@/lib/api";

interface ComposerProps {
  model: ChatModel;
  reasoningEffort: ReasoningEffort | null;
  busy: boolean;
  onModelChange: (m: ChatModel) => void;
  onEffortChange: (e: ReasoningEffort) => void;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
}

export function Composer({
  model,
  reasoningEffort,
  busy,
  onModelChange,
  onEffortChange,
  onSubmit,
  onInterrupt,
}: ComposerProps) {
  const [value, setValue] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  function trySubmit() {
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl + Enter sends; plain Enter (no shift) also sends; Shift+Enter
    // inserts a newline.
    if (e.key === "Enter") {
      if (e.metaKey || e.ctrlKey || !e.shiftKey) {
        e.preventDefault();
        trySubmit();
      }
    }
  }

  return (
    <div className="border-t border-border bg-background p-3">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <ModelPicker value={model} onChange={onModelChange} disabled={busy} />
          {modelSupportsReasoning(model) && (
            <EffortPicker value={reasoningEffort} onChange={onEffortChange} disabled={busy} />
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? "Streaming…" : "Ask anything. ⌘+↵ sends · Shift+↵ newline"}
            rows={2}
            className="min-h-[60px] resize-none"
            disabled={busy}
          />
          {busy ? (
            <Button onClick={onInterrupt} variant="outline" size="sm">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button onClick={trySubmit} size="sm" disabled={!value.trim()}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

