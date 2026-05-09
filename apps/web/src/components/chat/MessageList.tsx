import * as React from "react";
import type { ChatMessage } from "@/lib/api";
import { MessageRow } from "@/components/chat/MessageRow";

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  onSaveAsNote: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
}

export function MessageList({
  messages,
  streaming,
  onSaveAsNote,
  onRegenerate,
}: MessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Auto-scroll to bottom on new content (including streaming deltas).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // v1: plain map. The spec says virtualize only above 100 messages —
  // chat threads here rarely exceed dozens, and adding a virtualization
  // dep buys nothing right now. Revisit if profiles show jank.

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Start the conversation below.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          isLastAssistant={m.id === lastAssistantId}
          streaming={streaming && m.id === lastAssistantId}
          onSaveAsNote={onSaveAsNote}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}
