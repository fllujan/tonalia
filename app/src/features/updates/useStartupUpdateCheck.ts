import { useEffect } from "react";
import { useUpdateStore } from "./updateStore";

/** A few seconds after start-up, when the setting allows it; quiet when offline. */
export const STARTUP_DELAY_MS = 5000;

export function useStartupUpdateCheck(enabled: boolean): void {
  useEffect(() => {
    // Not from `pnpm dev`: the dev build has no release to compare with.
    if (!enabled || import.meta.env.MODE === "development") return;
    const timer = window.setTimeout(
      () => void useUpdateStore.getState().checkNow(true),
      STARTUP_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [enabled]);
}
