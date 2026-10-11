// Pointer-driven drag and drop for tracks and playlists (SPEC 2.11).
//
// HTML5 drag and drop is not used: Tauri's native file-drop handling (needed to drop
// folders from the Finder/Explorer) disables it inside the webview on Windows. A drag
// starts after the pointer moves a few pixels; drop targets report themselves while the
// pointer is over them; Escape cancels.
import type React from "react";
import { create } from "zustand";
import type { DropZone } from "./tree";

export type DragPayload =
  | { kind: "tracks"; trackIds: [number, ...number[]]; label: string }
  | { kind: "playlist"; id: number; label: string; smart: boolean; isFolder: boolean };

export type DropTarget =
  | { kind: "playlist"; id: number; zone: DropZone }
  /** Insert before the row at `index` of the open playlist (`index` = count: at the end). */
  | { kind: "row"; index: number };

type DropHandler = (payload: DragPayload, target: DropTarget) => void;

interface DragState {
  payload: DragPayload | null;
  x: number;
  y: number;
  target: DropTarget | null;
  setTarget: (target: DropTarget | null) => void;
}

export const useDragStore = create<DragState>((set) => ({
  payload: null,
  x: 0,
  y: 0,
  target: null,
  setTarget: (target) => set({ target }),
}));

let dropHandler: DropHandler | null = null;

/** The single place that turns drops into engine calls (see `DragLayer`). */
export function setDropHandler(handler: DropHandler | null): void {
  dropHandler = handler;
}

const THRESHOLD = 5;

/** Call from `onPointerDown`; `payload` is built only if the pointer really drags. */
export function beginDrag(e: React.PointerEvent, payload: () => DragPayload): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;

  const finish = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("select-none");
    useDragStore.setState({ payload: null, target: null });
  };
  const onMove = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      active = true;
      document.body.classList.add("select-none");
      useDragStore.setState({ payload: payload(), target: null });
    }
    useDragStore.setState({ x: ev.clientX, y: ev.clientY });
  };
  const onUp = () => {
    const { payload: dragged, target } = useDragStore.getState();
    finish();
    if (!active) return;
    // The click that ends a drag must not also activate what is under the pointer.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (dragged && target) dropHandler?.(dragged, target);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      active = false;
      finish();
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}

/** Pointer handlers for a drop target; inert unless something is being dragged. */
export function dropTargetProps(
  dragging: boolean,
  describe: (e: React.PointerEvent<HTMLElement>) => DropTarget | null,
): Pick<React.HTMLAttributes<HTMLElement>, "onPointerMove" | "onPointerLeave"> {
  if (!dragging) return {};
  return {
    onPointerMove: (e) => useDragStore.getState().setTarget(describe(e)),
    onPointerLeave: () => useDragStore.getState().setTarget(null),
  };
}
