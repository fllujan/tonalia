// App-wide shortcuts: ⌘/Ctrl+1–4 and ⌘/Ctrl+, switch views, "?" shows every shortcut.
// (⌘F lives with the search box; screen shortcuts live with their screens.)
import { useEffect } from "react";
import { ownsKey } from "../../lib/keyboard";
import { useViewStore } from "../navigation/viewStore";
import { useShortcutsDialog } from "./shortcuts";

const VIEWS = {
  "1": "library",
  "2": "pro",
  "3": "favorites",
  "4": "builder",
  ",": "settings",
} as const;

export function useGlobalShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key in VIEWS) {
        if (document.querySelector("[role=dialog][aria-modal=true]")) return;
        e.preventDefault();
        useViewStore.getState().show(VIEWS[e.key as keyof typeof VIEWS]);
      } else if (e.key === "?" && !ownsKey(e)) {
        e.preventDefault();
        useShortcutsDialog.getState().setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
