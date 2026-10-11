// Files dragged from the OS onto the window. Tauri's webview event carries real file
// paths (HTML5 drag events do not), so the engine can import them directly.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let webview: ReturnType<typeof getCurrentWebview>;
    try {
      webview = getCurrentWebview();
    } catch {
      return; // Not running inside Tauri (tests, plain browser).
    }
    webview
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else {
          setDragging(false);
          onDrop(payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDrop]);

  return dragging;
}
