import type { Cue } from "../../lib/rpc.types";

/**
 * Where "next cue" / "previous cue" lands from `time`: the next cue after the playhead, or
 * the previous one before it. Going back from just after a cue skips it (so a second press
 * keeps moving), and going back before the first cue returns to the start. Null when there
 * is no next cue.
 */
export function cueStep(cues: readonly Cue[], time: number, direction: 1 | -1): number | null {
  const sorted = [...cues].sort((a, b) => a.positionSec - b.positionSec);
  if (direction === 1) return sorted.find((c) => c.positionSec > time + 0.05)?.positionSec ?? null;
  const before = sorted.filter((c) => c.positionSec < time - 0.5);
  return before[before.length - 1]?.positionSec ?? 0;
}
