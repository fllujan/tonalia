// Section names above a waveform (DESIGN 5.9): a short deck waveform leaves some
// sections narrower than their name, so they fall back to an abbreviation and, when even
// that does not fit, to no name (the coloured strip under the wave still shows them).
// Names are measured in the real font, so a wide one ("BREAKDOWN") never runs into the
// next section's name.

/** Rough width of one uppercase `text-label` character, where nothing can measure text. */
const CHAR_PX = 7.6;
/** `text-label`: 11 px, semibold, +4 % letter spacing, uppercase. */
const SIZE_PX = 11;
const TRACKING = 0.04;

let context: CanvasRenderingContext2D | null | undefined;

/** Width in pixels of `text` as a section name (`text-label`, uppercase). */
export function labelWidth(text: string): number {
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return text.length * CHAR_PX;
  context.font = `600 ${SIZE_PX}px ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text.toUpperCase()).width + text.length * SIZE_PX * TRACKING;
}

/** The label that fits in `space` pixels: the full name, the short one, or none. */
export function fitSectionLabel(
  full: string,
  short: string,
  space: number,
  measure: (text: string) => number = labelWidth,
): string | null {
  if (measure(full) <= space) return full;
  if (measure(short) <= space) return short;
  return null;
}
