import * as React from "react";

export type ColorMode = "light" | "dark";

type ColorModeContextValue = {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
};

const STORAGE_KEY = "ui-color-mode";

const ColorModeContext = React.createContext<ColorModeContextValue | null>(null);

function readInitialMode(): ColorMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ColorModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ColorMode>(readInitialMode);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = React.useCallback((next: ColorMode) => setModeState(next), []);
  const toggle = React.useCallback(() => setModeState((m) => (m === "dark" ? "light" : "dark")), []);

  const value = React.useMemo(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): ColorModeContextValue {
  const ctx = React.useContext(ColorModeContext);
  if (!ctx) throw new Error("useColorMode must be used inside <ColorModeProvider>");
  return ctx;
}
