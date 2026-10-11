// Tap tempo: BPM from the times (ms) the user tapped a button or key.

/** A pause longer than this starts a new measurement. */
export const TAP_RESET_MS = 2000;
const MAX_TAPS = 16;

/** Taps that belong to the current measurement (the run after the last long pause). */
export function currentRun(taps: number[]): number[] {
  let start = 0;
  for (let i = 1; i < taps.length; i++) {
    if ((taps[i] ?? 0) - (taps[i - 1] ?? 0) > TAP_RESET_MS) start = i;
  }
  return taps.slice(start).slice(-MAX_TAPS);
}

/** BPM with two decimals once there are at least three taps (two intervals). */
export function tapBpm(taps: number[]): number | null {
  const run = currentRun(taps);
  if (run.length < 3) return null;
  const span = (run[run.length - 1] ?? 0) - (run[0] ?? 0);
  if (span <= 0) return null;
  const bpm = (60000 * (run.length - 1)) / span;
  return Math.round(bpm * 100) / 100;
}
