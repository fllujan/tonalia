import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  anchor: HTMLElement;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Floating panel anchored below an element, rendered in a portal so the scrolling table
 * cannot clip it. Escape or a click outside closes it; focus moves inside on open and
 * returns to the anchor on close.
 */
export function Popover({ anchor, label, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const width = ref.current?.offsetWidth ?? 0;
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? rect.top - height - 4 : below;
    setPosition({ top: Math.max(8, top), left });
  }, [anchor]);

  useEffect(() => {
    const panel = ref.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>("button, input");
    target?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (panel && !panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      anchor.focus();
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={position}
      className="fixed z-50 rounded-md border border-border bg-surface-1 p-3 shadow-overlay"
    >
      {children}
    </div>,
    document.body,
  );
}
