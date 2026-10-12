import { useLayoutEffect, useRef } from "react";

const ACTIVE = '[aria-checked="true"], [aria-selected="true"]';

/**
 * The raised "thumb" of a segmented selector (DESIGN 5.8), sliding to the active option
 * instead of jumping. Drop it as the first child of a `relative` radiogroup or tablist:
 * it measures the option marked `aria-checked`/`aria-selected` after every render and
 * on resize. Until it has measured (and in tests, where nothing has a size) the options
 * keep their own `bg-surface-3`, so the selector never renders without its selection.
 */
export function SegmentThumb() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const thumb = ref.current;
    const group = thumb?.parentElement;
    if (!thumb || !group) return;
    const place = () => {
      const active = group.querySelector<HTMLElement>(ACTIVE);
      if (!active || !active.offsetWidth) {
        delete group.dataset.thumb;
        thumb.style.opacity = "0";
        return;
      }
      thumb.style.opacity = "1";
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.height = `${active.offsetHeight}px`;
      thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      if (!group.dataset.thumb) {
        // First placement lands without sliding; later moves animate.
        group.dataset.thumb = "placed";
        requestAnimationFrame(() => {
          if (group.dataset.thumb) group.dataset.thumb = "ready";
        });
      }
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(group);
    const mutations = new MutationObserver(place);
    mutations.observe(group, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-checked", "aria-selected"],
    });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden
      data-segment-thumb
      className="pointer-events-none absolute left-0 top-0 rounded-[5px] bg-surface-3 opacity-0"
    />
  );
}
