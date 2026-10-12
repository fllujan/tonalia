// Section names above a waveform (DESIGN 5.9): a short deck waveform leaves some
// sections narrower than their name, so they fall back to an abbreviation and, when even
// that does not fit, to no name (the coloured strip under the wave still shows them).

/** Rough width of one uppercase `text-label` character (11 px, semibold, +4 %). */
const CHAR_PX = 7.6;

/** The label that fits in `space` pixels: the full name, the short one, or none. */
export function fitSectionLabel(full: string, short: string, space: number): string | null {
  if (full.length * CHAR_PX <= space) return full;
  if (short.length * CHAR_PX <= space) return short;
  return null;
}
