import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useColorMode } from "@/theme/ColorModeProvider";

export function ModeToggle() {
  const { mode, toggle } = useColorMode();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
