import { Bookmark, Bot, Copy, RotateCw, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage } from "@/lib/api";
import { modelLabel } from "@/components/chat/ModelPicker";
import type { ChatModel } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MessageRowProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  streaming: boolean;
  onSaveAsNote: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
}

export function MessageRow({
  message,
  isLastAssistant,
  streaming,
  onSaveAsNote,
  onRegenerate,
}: MessageRowProps) {
  const isUser = message.role === "user";
  const toolUses = parseToolUses(message.toolUses);
  const showThinkingDot = isLastAssistant && streaming && !message.content;
  const showActions = !isUser && !streaming && message.content.length > 0;

  return (
    <div className={cn("group flex gap-3 px-5 py-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <Avatar role={isUser ? "user" : "assistant"} />
      <div className={cn("flex max-w-[80%] flex-col gap-1", isUser && "items-end")}>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-semibold">
            {isUser ? "you" : message.model ? modelLabel(message.model as ChatModel) : "assistant"}
          </span>
        </div>
        <Card
          className={cn(
            "px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted/40",
          )}
        >
          {message.content || (showThinkingDot ? <ThinkingDot /> : <span className="opacity-50">…</span>)}
          {toolUses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {toolUses.map((t, i) => (
                <Badge key={i} className="text-[10px]">
                  {t.toolName}
                </Badge>
              ))}
            </div>
          )}
        </Card>
        {showActions && (
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onSaveAsNote(message)}
            >
              <Bookmark className="h-3.5 w-3.5" />
              Save as note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => void navigator.clipboard.writeText(message.content)}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            {isLastAssistant && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onRegenerate(message)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
      )}
    >
      {role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
    </div>
  );
}

function ThinkingDot() {
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}

function parseToolUses(raw: string | null): Array<{ toolName: string }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
