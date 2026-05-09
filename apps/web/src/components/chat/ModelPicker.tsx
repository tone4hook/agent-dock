import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatModel } from "@/lib/api";

const MODEL_LABELS: Record<ChatModel, string> = {
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

interface ModelPickerProps {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ChatModel)} disabled={disabled}>
      <SelectTrigger className="h-8 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="claude-opus-4-7">{MODEL_LABELS["claude-opus-4-7"]}</SelectItem>
        <SelectItem value="claude-sonnet-4-6">{MODEL_LABELS["claude-sonnet-4-6"]}</SelectItem>
        <SelectItem value="claude-haiku-4-5-20251001">
          {MODEL_LABELS["claude-haiku-4-5-20251001"]}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function modelLabel(model: ChatModel): string {
  return MODEL_LABELS[model];
}

export function modelSupportsReasoning(model: ChatModel): boolean {
  return model === "claude-opus-4-7" || model === "claude-sonnet-4-6";
}
