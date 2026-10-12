// Timing of the synchronized decks (SPEC 2.15): both renders are scheduled on the same
// AudioContext clock so their downbeats land on the same instant.

/**
 * Start time (AudioContext seconds) of each buffer so that the first downbeat of every
 * buffer (`downbeats[i]`, seconds from the buffer start) plays `delays[i]` seconds after
 * one common downbeat, and nothing starts before `now + lead`.
 */
export function alignStarts(
  downbeats: readonly number[],
  delays: readonly number[],
  now: number,
  lead = 0.12,
): number[] {
  const late = Math.max(0, ...downbeats.map((d, i) => d - (delays[i] ?? 0)));
  const common = now + lead + late;
  return downbeats.map((d, i) => common + (delays[i] ?? 0) - d);
}

/** Equal-power gains for a crossfader position x ∈ [0, 1] (0 = only A, 1 = only B). */
export function crossfadeGains(x: number): { a: number; b: number } {
  const v = Math.min(1, Math.max(0, x));
  return { a: Math.cos((v * Math.PI) / 2), b: Math.sin((v * Math.PI) / 2) };
}

/** Equal-power fade curve with `points` values: "out" goes 1 → 0, "in" 0 → 1. */
export function fadeCurve(direction: "in" | "out", points = 64): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    const g = crossfadeGains(x);
    curve[i] = direction === "out" ? g.a : g.b;
  }
  return curve;
}
