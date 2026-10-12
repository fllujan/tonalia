// A scrolling panel that says there is more (critique: the filters popover hid Estado and
// Calidad below the fold with nothing to show it). A shade lies over the top or bottom
// edge while the content goes on that way; it sits above the fields, so opaque controls
// cannot hide it the way they hide a background.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function ScrollArea({
  className,
  frameClassName = "",
  children,
}: {
  /** The scrolling box. */
  className: string;
  /** The frame the shades span (e.g. negative margins to reach a panel's edges). */
  frameClassName?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className={`relative flex min-h-0 flex-col ${frameClassName}`}>
      <div ref={box} onScroll={measure} className={className}>
        {children}
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-4 rounded-t-md transition-opacity duration-hover ${edges.top ? "opacity-100" : "opacity-0"}`}
        style={{ background: "linear-gradient(var(--color-scroll-shade), transparent)" }}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-4 transition-opacity duration-hover ${edges.bottom ? "opacity-100" : "opacity-0"}`}
        style={{ background: "linear-gradient(transparent, var(--color-scroll-shade))" }}
      />
    </div>
  );
}
