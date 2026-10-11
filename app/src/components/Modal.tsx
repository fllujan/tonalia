import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Centered dialog (DESIGN 4: 14 px radius, overlay shadow). Escape or a click on the
 * backdrop closes it; focus moves inside on open, stays inside with Tab and returns to
 * the previously focused element on close.
 */
export function Modal({
  label,
  onClose,
  children,
  width = 560,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusable = () => [
      ...(panel?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea",
      ) ?? []),
    ];
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-bg)_72%,transparent)] p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ width }}
        className="flex max-h-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-overlay"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
