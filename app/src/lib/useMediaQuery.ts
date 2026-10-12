// Follows a CSS media query (for values CSS cannot set, such as a canvas height).
// jsdom has no matchMedia: there, the query never matches.
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
}

/** The short-window layout (CSS variant `short:`, index.css): the 760 px minimum height. */
export const SHORT_WINDOW = "(max-height: 880px)";
