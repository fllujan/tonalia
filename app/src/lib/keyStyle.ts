import { type Key, wheelLetter, wheelNumber } from "./keys";

/** Below this confidence the key is flagged discreetly (SPEC 2.2). */
export const LOW_CONFIDENCE = 0.5;

/** CSS colour of a key: its position on the harmonic wheel (DESIGN 2.3). */
export function keyColor(key: Key): string {
  return `var(--color-key-${wheelNumber(key)}${wheelLetter(key).toLowerCase()})`;
}
