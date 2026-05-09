// Translate ⌘C / ⌘V / ⌘X / ⌘A keystrokes into clipboard ops on the
// focused <input>/<textarea>. Neutralino's WKWebView does not install
// a macOS Edit menu by default, so the OS drops these keystrokes —
// without this, paste etc. only work via the right-click context menu.

type EditableField = HTMLInputElement | HTMLTextAreaElement;

function isEditableField(el: Element | null): el is EditableField {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    // setRangeText / selectionStart are only valid on text-like inputs.
    const t = el.type;
    return (
      t === "text" ||
      t === "search" ||
      t === "url" ||
      t === "tel" ||
      t === "password" ||
      t === "email" ||
      t === ""
    );
  }
  return false;
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

function fireInput(el: EditableField): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function installClipboardShortcuts(): () => void {
  async function handler(e: KeyboardEvent): Promise<void> {
    if (!e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== "c" && key !== "v" && key !== "x" && key !== "a") return;
    const el = document.activeElement;
    if (!isEditableField(el)) return;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;

    if (key === "a") {
      e.preventDefault();
      el.select();
      return;
    }

    if (key === "c") {
      const sel = el.value.slice(start, end);
      if (!sel) return;
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(sel);
      } catch {
        /* best-effort */
      }
      return;
    }

    if (key === "x") {
      const sel = el.value.slice(start, end);
      if (!sel) return;
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(sel);
      } catch {
        /* best-effort */
      }
      el.setRangeText("", start, end, "end");
      fireInput(el);
      return;
    }

    if (key === "v") {
      e.preventDefault();
      const text = await readClipboard();
      if (!text) return;
      el.setRangeText(text, start, end, "end");
      fireInput(el);
    }
  }

  function listener(e: KeyboardEvent): void {
    void handler(e);
  }

  window.addEventListener("keydown", listener, { capture: true });
  return () => window.removeEventListener("keydown", listener, { capture: true });
}
