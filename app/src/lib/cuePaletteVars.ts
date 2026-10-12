// The cue palette chosen in Settings (SPEC 2.14) repaints every place that draws a
// section or a cue from the --color-cue-N tokens: segment strips, flags and pads.
import { useEffect } from "react";
import { CUE_PALETTE } from "./sections";

export function useCuePaletteVars(colors: readonly string[]): void {
  const key = colors.join();
  useEffect(() => {
    const style = document.documentElement.style;
    key.split(",").forEach((color, i) => {
      const name = `--color-cue-${i + 1}`;
      if (color.toUpperCase() === CUE_PALETTE[i]?.toUpperCase()) style.removeProperty(name);
      else style.setProperty(name, color);
    });
  }, [key]);
}
