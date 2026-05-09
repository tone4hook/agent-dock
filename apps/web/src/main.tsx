import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { installClipboardShortcuts } from "@/lib/clipboard-shortcuts";
import { ColorModeProvider } from "@/theme/ColorModeProvider";
import "./app.css";

installClipboardShortcuts();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorModeProvider>
      <App />
    </ColorModeProvider>
  </React.StrictMode>,
);
