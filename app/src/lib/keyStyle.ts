import { type Key, makeKey, wheelLetter, wheelNumber } from "./keys";

/** The key of a track (summary or detail), or null before it is known. */
export function trackKey(track: {
  keyRoot?: number | null;
  keyMode?: "major" | "minor" | null;
}): Key | null {
  return track.keyRoot == null || track.keyMode == null
    ? null
    : makeKey(track.keyRoot, track.keyMode);
}

/** Below this confidence the key is flagged discreetly (SPEC 2.2). */
export const LOW_CONFIDENCE = 0.5;

/** CSS colour of a key: its position on the harmonic wheel (DESIGN 2.3). */
export function keyColor(key: Key): string {
  return `var(--color-key-${wheelNumber(key)}${wheelLetter(key).toLowerCase()})`;
}
