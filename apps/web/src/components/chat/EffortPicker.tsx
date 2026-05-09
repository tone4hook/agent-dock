import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReasoningEffort } from "@/lib/api";

interface EffortPickerProps {
  value: ReasoningEffort | null;
  onChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}

export function EffortPicker({ value, onChange, disabled }: EffortPickerProps) {
  return (
    <Select
      value={value ?? "medium"}
      onValueChange={(v) => onChange(v as ReasoningEffort)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="high">High</SelectItem>
      </SelectContent>
    </Select>
  );
}
